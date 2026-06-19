use serde::Deserialize;
use std::process::Command;

#[derive(Debug, Deserialize)]
struct SshProfile {
    user: String,
    host: String,
    port: u16,
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
            ("gnome-terminal", vec!["--", "ssh", &target, "-p", &port]),
            ("konsole", vec!["-e", "ssh", &target, "-p", &port]),
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

#[cfg(target_os = "macos")]
fn escape_osascript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_ssh])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
