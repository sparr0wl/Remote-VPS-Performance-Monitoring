use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct SshProfile {
    user: String,
    host: String,
    port: u16,
}

#[derive(Debug, Deserialize)]
struct AgentRequest {
    endpoint: String,
    token: String,
    method: String,
    path: String,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
struct AgentResponse {
    status: u16,
    body: String,
}

#[tauri::command]
async fn agent_request(request: AgentRequest) -> Result<AgentResponse, String> {
    tauri::async_runtime::spawn_blocking(move || agent_request_blocking(request))
        .await
        .map_err(|err| format!("agent request task failed: {}", err))?
}

fn agent_request_blocking(request: AgentRequest) -> Result<AgentResponse, String> {
    let endpoint = parse_http_endpoint(&request.endpoint)?;
    let method = request.method.to_ascii_uppercase();
    if method != "GET" && method != "POST" {
        return Err("unsupported method".into());
    }
    if !request.path.starts_with('/') || request.path.contains('\r') || request.path.contains('\n') {
        return Err("invalid request path".into());
    }
    if request.token.contains('\r') || request.token.contains('\n') {
        return Err("invalid token".into());
    }

    let body = request.body.unwrap_or_default();
    let address = format!("{}:{}", endpoint.host, endpoint.port);
    let mut addrs = address
        .to_socket_addrs()
        .map_err(|err| format!("resolve {}: {}", address, err))?;
    let addr = addrs.next().ok_or_else(|| format!("resolve {}: no addresses", address))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(8))
        .map_err(|err| format!("connect {}: {}", address, err))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(12)))
        .map_err(|err| err.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(8)))
        .map_err(|err| err.to_string())?;

    let request_text = format!(
        "{method} {} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        request.path,
        endpoint.host_header,
        request.token,
        body.as_bytes().len(),
        body
    );
    stream
        .write_all(request_text.as_bytes())
        .map_err(|err| format!("write request: {}", err))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|err| format!("read response: {}", err))?;
    parse_http_response(&response)
}

#[tauri::command]
fn open_ssh(profile: SshProfile) -> Result<(), String> {
    validate_part(&profile.user, "user")?;
    validate_part(&profile.host, "host")?;
    if profile.port == 0 {
        return Err("invalid port".into());
    }

    let target = format!("{}@{}", profile.user, profile.host);
    let command_text = format!("ssh {} -p {}", target, profile.port);

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"\ntell application \"Terminal\" to activate",
            escape_osascript(&command_text)
        );
        spawn_command(Command::new("osascript").arg("-e").arg(script))
    }

    #[cfg(target_os = "windows")]
    {
        let port = profile.port.to_string();
        let status = Command::new("cmd")
            .args(["/C", "start", "wt", "ssh", &target, "-p", &port])
            .status();
        if status.as_ref().map(|s| s.success()).unwrap_or(false) {
            return Ok(());
        }
        let ps_arg = format!("Start-Process powershell -ArgumentList 'ssh {} -p {}'", target, port);
        spawn_command(Command::new("powershell").args([
            "-NoProfile",
            "-Command",
            &ps_arg,
        ]))
    }

    #[cfg(target_os = "linux")]
    {
        let port = profile.port.to_string();
        let terminal = std::env::var("TERMINAL").ok();
        if let Some(term) = terminal {
            let mut command = Command::new(term);
            command.args(["-e", "ssh", &target, "-p", &port]);
            if spawn_command(&mut command).is_ok() {
                return Ok(());
            }
        }

        let candidates: Vec<(&str, Vec<&str>)> = vec![
            ("xdg-terminal-exec", vec!["ssh", &target, "-p", &port]),
            ("ptyxis", vec!["--", "ssh", &target, "-p", &port]),
            ("kgx", vec!["--", "ssh", &target, "-p", &port]),
            ("gnome-terminal", vec!["--", "ssh", &target, "-p", &port]),
            ("konsole", vec!["-e", "ssh", &target, "-p", &port]),
            ("wezterm", vec!["start", "--", "ssh", &target, "-p", &port]),
            ("alacritty", vec!["-e", "ssh", &target, "-p", &port]),
            ("kitty", vec!["ssh", &target, "-p", &port]),
            ("footclient", vec!["ssh", &target, "-p", &port]),
            ("foot", vec!["ssh", &target, "-p", &port]),
            ("xfce4-terminal", vec!["-e", &command_text]),
            ("xterm", vec!["-e", "ssh", &target, "-p", &port]),
        ];
        for (bin, args) in candidates {
            let mut command = Command::new(bin);
            command.args(args);
            if spawn_command(&mut command).is_ok() {
                return Ok(());
            }
        }
        Err("no supported terminal found".into())
    }
}

fn validate_part(value: &str, name: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 255
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '@' | ':'))
    {
        return Err(format!("invalid {}", name));
    }
    Ok(())
}

fn spawn_command(command: &mut Command) -> Result<(), String> {
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("failed to open terminal: {}", err))
}

struct ParsedEndpoint {
    host: String,
    host_header: String,
    port: u16,
}

fn parse_http_endpoint(value: &str) -> Result<ParsedEndpoint, String> {
    let without_scheme = value
        .trim()
        .strip_prefix("http://")
        .ok_or_else(|| "desktop client currently supports http:// agent endpoints".to_string())?;
    let authority = without_scheme
        .split('/')
        .next()
        .ok_or_else(|| "invalid endpoint".to_string())?;
    if authority.is_empty() || authority.contains('@') || authority.contains('\r') || authority.contains('\n') {
        return Err("invalid endpoint host".into());
    }
    let (host, port) = if authority.starts_with('[') {
        let end = authority.find(']').ok_or_else(|| "invalid IPv6 endpoint".to_string())?;
        let host = authority[1..end].to_string();
        let rest = &authority[end + 1..];
        let port = if let Some(port_text) = rest.strip_prefix(':') {
            port_text.parse::<u16>().map_err(|_| "invalid endpoint port".to_string())?
        } else {
            80
        };
        (host, port)
    } else if let Some((host, port_text)) = authority.rsplit_once(':') {
        (host.to_string(), port_text.parse::<u16>().map_err(|_| "invalid endpoint port".to_string())?)
    } else {
        (authority.to_string(), 80)
    };
    if host.is_empty() || port == 0 {
        return Err("invalid endpoint".into());
    }
    Ok(ParsedEndpoint {
        host,
        host_header: authority.to_string(),
        port,
    })
}

fn parse_http_response(response: &[u8]) -> Result<AgentResponse, String> {
    let marker = b"\r\n\r\n";
    let header_end = response
        .windows(marker.len())
        .position(|window| window == marker)
        .ok_or_else(|| "invalid HTTP response".to_string())?;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    let status_line = headers.lines().next().ok_or_else(|| "missing status line".to_string())?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "missing status code".to_string())?
        .parse::<u16>()
        .map_err(|_| "invalid status code".to_string())?;
    let raw_body = &response[header_end + marker.len()..];
    let body_bytes = if headers
        .lines()
        .any(|line| line.to_ascii_lowercase().starts_with("transfer-encoding: chunked"))
    {
        decode_chunked(raw_body)?
    } else {
        raw_body.to_vec()
    };
    let body = String::from_utf8_lossy(&body_bytes).to_string();
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {}: {}", status, body));
    }
    Ok(AgentResponse { status, body })
}

fn decode_chunked(input: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut pos = 0;
    loop {
        let line_end = find_crlf(input, pos).ok_or_else(|| "invalid chunked response".to_string())?;
        let size_text = String::from_utf8_lossy(&input[pos..line_end]);
        let size_hex = size_text
            .split(';')
            .next()
            .ok_or_else(|| "invalid chunk size".to_string())?
            .trim();
        let size = usize::from_str_radix(size_hex, 16).map_err(|_| "invalid chunk size".to_string())?;
        pos = line_end + 2;
        if size == 0 {
            break;
        }
        if pos + size > input.len() {
            return Err("truncated chunked response".into());
        }
        out.extend_from_slice(&input[pos..pos + size]);
        pos += size;
        if input.get(pos..pos + 2) != Some(b"\r\n") {
            return Err("invalid chunk terminator".into());
        }
        pos += 2;
    }
    Ok(out)
}

fn find_crlf(input: &[u8], start: usize) -> Option<usize> {
    input
        .get(start..)?
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|offset| start + offset)
}

#[cfg(target_os = "macos")]
fn escape_osascript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "linux")]
fn configure_linux_display_backend() {
    let has_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let has_x11 = std::env::var_os("DISPLAY").is_some();

    if std::env::var_os("WINIT_UNIX_BACKEND").is_none() {
        if has_wayland {
            std::env::set_var("WINIT_UNIX_BACKEND", "wayland");
        } else if has_x11 {
            std::env::set_var("WINIT_UNIX_BACKEND", "x11");
        }
    }

    if std::env::var_os("GDK_BACKEND").is_none() {
        if has_wayland && has_x11 {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        } else if has_wayland {
            std::env::set_var("GDK_BACKEND", "wayland");
        } else if has_x11 {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_linux_display_backend();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![agent_request, open_ssh])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
