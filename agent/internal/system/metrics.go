package system

import (
	"bufio"
	"errors"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type Metrics struct {
	Hostname string          `json:"hostname"`
	OS       string          `json:"os"`
	Uptime   float64         `json:"uptimeSeconds"`
	Load     []float64       `json:"loadAverage"`
	CPU      CPUMetrics      `json:"cpu"`
	Memory   MemoryMetrics   `json:"memory"`
	Disk     DiskMetrics     `json:"disk"`
	Network  []NetworkMetric `json:"network"`
	Time     time.Time       `json:"time"`
}

type CPUMetrics struct {
	Percent float64 `json:"percent"`
	Cores   int     `json:"cores"`
}

type MemoryMetrics struct {
	Total       uint64  `json:"total"`
	Available   uint64  `json:"available"`
	Used        uint64  `json:"used"`
	UsedPercent float64 `json:"usedPercent"`
}

type DiskMetrics struct {
	Mount       string  `json:"mount"`
	Total       uint64  `json:"total"`
	Free        uint64  `json:"free"`
	Used        uint64  `json:"used"`
	UsedPercent float64 `json:"usedPercent"`
}

type NetworkMetric struct {
	Interface string `json:"interface"`
	RxBytes   uint64 `json:"rxBytes"`
	TxBytes   uint64 `json:"txBytes"`
}

func CollectMetrics() (Metrics, error) {
	if runtime.GOOS != "linux" {
		return Metrics{}, errors.New("agent metrics are only supported on linux")
	}
	host, _ := os.Hostname()
	mem, err := readMemory()
	if err != nil {
		return Metrics{}, err
	}
	disk, err := readDisk("/")
	if err != nil {
		return Metrics{}, err
	}
	net, _ := readNetwork()
	load, _ := readLoad()
	uptime, _ := readUptime()
	cpu, _ := readCPUPercent()

	return Metrics{
		Hostname: host,
		OS:       runtime.GOOS,
		Uptime:   uptime,
		Load:     load,
		CPU:      cpu,
		Memory:   mem,
		Disk:     disk,
		Network:  net,
		Time:     time.Now().UTC(),
	}, nil
}

func readCPUPercent() (CPUMetrics, error) {
	a, err := readCPUStat()
	if err != nil {
		return CPUMetrics{Cores: runtime.NumCPU()}, err
	}
	time.Sleep(250 * time.Millisecond)
	b, err := readCPUStat()
	if err != nil {
		return CPUMetrics{Cores: runtime.NumCPU()}, err
	}
	totalDelta := float64(b.total - a.total)
	idleDelta := float64(b.idle - a.idle)
	percent := 0.0
	if totalDelta > 0 {
		percent = (1 - idleDelta/totalDelta) * 100
	}
	return CPUMetrics{Percent: round(percent), Cores: runtime.NumCPU()}, nil
}

type cpuStat struct {
	total uint64
	idle  uint64
}

func readCPUStat() (cpuStat, error) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return cpuStat{}, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return cpuStat{}, scanner.Err()
	}
	fields := strings.Fields(scanner.Text())
	var values []uint64
	for _, f := range fields[1:] {
		v, _ := strconv.ParseUint(f, 10, 64)
		values = append(values, v)
	}
	var total uint64
	for _, v := range values {
		total += v
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return cpuStat{total: total, idle: idle}, nil
}

func readMemory() (MemoryMetrics, error) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return MemoryMetrics{}, err
	}
	values := map[string]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		v, _ := strconv.ParseUint(fields[1], 10, 64)
		values[key] = v * 1024
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	used := total - available
	percent := 0.0
	if total > 0 {
		percent = float64(used) / float64(total) * 100
	}
	return MemoryMetrics{Total: total, Available: available, Used: used, UsedPercent: round(percent)}, nil
}

func readDisk(mount string) (DiskMetrics, error) {
	var fs syscall.Statfs_t
	if err := syscall.Statfs(mount, &fs); err != nil {
		return DiskMetrics{}, err
	}
	total := fs.Blocks * uint64(fs.Bsize)
	free := fs.Bavail * uint64(fs.Bsize)
	used := total - free
	percent := 0.0
	if total > 0 {
		percent = float64(used) / float64(total) * 100
	}
	return DiskMetrics{Mount: mount, Total: total, Free: free, Used: used, UsedPercent: round(percent)}, nil
}

func readNetwork() ([]NetworkMetric, error) {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil, err
	}
	var out []NetworkMetric
	for _, line := range strings.Split(string(data), "\n")[2:] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		name, values, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		fields := strings.Fields(values)
		if len(fields) < 16 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		iface := strings.TrimSpace(name)
		if iface == "lo" {
			continue
		}
		out = append(out, NetworkMetric{Interface: iface, RxBytes: rx, TxBytes: tx})
	}
	return out, nil
}

func readLoad() ([]float64, error) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return nil, err
	}
	fields := strings.Fields(string(data))
	var out []float64
	for i := 0; i < 3 && i < len(fields); i++ {
		v, _ := strconv.ParseFloat(fields[i], 64)
		out = append(out, v)
	}
	return out, nil
}

func readUptime() (float64, error) {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0, nil
	}
	return strconv.ParseFloat(fields[0], 64)
}

func round(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}
