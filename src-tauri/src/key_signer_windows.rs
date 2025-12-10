/**
 * KeySigner Tauri Commands - Windows
 * Handles communication with NoorSigner via Named Pipes
 *
 * Unix (Mac/Linux): siehe key_signer.rs
 */

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use tauri::command;

/// Named Pipe path for NoorSigner daemon
const PIPE_NAME: &str = r"\\.\pipe\noorsigner";

/// Get the NoorSigner data directory (%APPDATA%\NoorSigner\)
fn get_noorsigner_data_path() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "Failed to get APPDATA directory".to_string())?;
    Ok(PathBuf::from(appdata).join("NoorSigner"))
}

/// Get NoorSigner binary path - runs directly from install directory
fn get_noorsigner_path() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get current executable path: {}", e))?;

    let exe_dir = exe_path.parent()
        .ok_or_else(|| "Failed to get executable directory".to_string())?;

    // NoorSigner is in the same directory as NoorNote
    let noorsigner_path = exe_dir.join("noorsigner.exe");

    if noorsigner_path.exists() {
        return Ok(noorsigner_path);
    }

    // Fallback: check for architecture-specific name (during development)
    let sidecar_path = exe_dir.join("noorsigner-x86_64-pc-windows-msvc.exe");
    if sidecar_path.exists() {
        return Ok(sidecar_path);
    }

    Err(format!(
        "NoorSigner not found. Searched in: {:?}",
        exe_dir
    ))
}

/// Ensure NoorSigner data directory exists
#[command]
pub async fn ensure_noorsigner_installed() -> Result<String, String> {
    use std::fs;

    // On Windows, NoorSigner runs from install dir - no copying needed
    // Just ensure the data directory exists
    let data_path = get_noorsigner_data_path()?;

    if !data_path.exists() {
        fs::create_dir_all(&data_path)
            .map_err(|e| format!("Failed to create NoorSigner data directory: {}", e))?;
        println!("Created NoorSigner data directory: {:?}", data_path);
    }

    // Verify NoorSigner binary exists in install directory
    let binary_path = get_noorsigner_path()?;
    println!("NoorSigner binary at: {:?}", binary_path);

    Ok(binary_path.display().to_string())
}

/// Send JSON-RPC request to KeySigner daemon via Named Pipe
#[command]
pub async fn key_signer_request(request: String) -> Result<String, String> {
    use std::fs::OpenOptions;

    // Open Named Pipe as a file
    let mut pipe = OpenOptions::new()
        .read(true)
        .write(true)
        .open(PIPE_NAME)
        .map_err(|e| format!("Failed to connect to NoorSigner daemon: {}. Is the daemon running?", e))?;

    // Write request
    let request_with_newline = format!("{}\n", request);
    pipe.write_all(request_with_newline.as_bytes())
        .map_err(|e| format!("Failed to send request: {}", e))?;

    pipe.flush()
        .map_err(|e| format!("Failed to flush request: {}", e))?;

    // Read response
    let mut reader = BufReader::new(&mut pipe);
    let mut response = String::new();
    reader.read_line(&mut response)
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(response.trim_end().to_string())
}

/// Check if Trust Mode session is valid
#[command]
pub async fn check_trust_session() -> Result<bool, String> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let trust_session_path = get_noorsigner_data_path()?.join("trust_session");

    if !trust_session_path.exists() {
        return Ok(false);
    }

    let content = fs::read_to_string(&trust_session_path)
        .map_err(|e| format!("Failed to read trust session: {}", e))?;

    let parts: Vec<&str> = content.split(':').collect();
    if parts.len() != 4 {
        return Ok(false);
    }

    let expires_unix: i64 = parts[1]
        .parse()
        .map_err(|_| "Invalid expiry timestamp".to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Failed to get current time".to_string())?
        .as_secs() as i64;

    Ok(now < expires_unix)
}

/// Check if NoorSigner daemon is running (Named Pipe exists)
fn is_daemon_running() -> bool {
    use std::fs::OpenOptions;

    OpenOptions::new()
        .read(true)
        .write(true)
        .open(PIPE_NAME)
        .is_ok()
}

/// Cancel KeySigner launch by killing any running noorsigner daemon process
#[command]
pub async fn cancel_key_signer_launch() -> Result<(), String> {
    use std::process::Command;

    let output = Command::new("taskkill")
        .args(["/F", "/IM", "noorsigner.exe"])
        .output()
        .map_err(|e| format!("Failed to kill noorsigner process: {}", e))?;

    if output.status.success() {
        println!("Killed noorsigner daemon process");
    } else {
        println!("No noorsigner daemon process found to kill");
    }
    Ok(())
}

/// Launch NoorSigner CLI binary
#[command]
pub async fn launch_key_signer(mode: String) -> Result<(), String> {
    use std::process::Command;

    ensure_noorsigner_installed().await?;

    let noorsigner_path = get_noorsigner_path()?;

    let cmd = match mode.as_str() {
        "init" => "init",
        "daemon" => "daemon",
        "add-account" => "add-account",
        _ => return Err(format!("Invalid mode: {}", mode)),
    };

    println!("Launching NoorSigner: {} {}", noorsigner_path.display(), cmd);

    let has_trust_session = check_trust_session().await.unwrap_or(false);
    let daemon_already_running = is_daemon_running();

    println!("Trust session valid: {}", has_trust_session);
    println!("Daemon already running: {}", daemon_already_running);

    // If trust session is valid and daemon not running, try background launch
    if has_trust_session && !daemon_already_running && mode == "daemon" {
        println!("Trust session valid + daemon not running - attempting background launch...");

        Command::new(&noorsigner_path)
            .arg(cmd)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("Failed to launch NoorSigner in background: {}", e))?;

        println!("Background daemon launched - waiting for pipe to appear...");

        use std::time::{Duration, Instant};
        let start = Instant::now();
        let timeout = Duration::from_secs(3);

        while start.elapsed() < timeout {
            if is_daemon_running() {
                println!("Named pipe available - daemon started successfully!");
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        println!("Pipe did not appear - trust session likely invalid, falling back to terminal launch");

        // Remove invalid trust session
        let trust_session_path = get_noorsigner_data_path()?.join("trust_session");
        if trust_session_path.exists() {
            let _ = std::fs::remove_file(&trust_session_path);
            println!("Removed invalid trust session file");
        }
    }

    // Launch in terminal for user input (password entry)
    println!("Launching in terminal for user input");

    // VARIANTE A: Separate args ohne manuelle Quotes
    println!("Trying Variante A: separate args");
    let _ = Command::new("cmd")
        .args(["/c", "start", "NoorSigner-A", "cmd", "/k", noorsigner_path.to_str().unwrap(), cmd])
        .spawn();

    // VARIANTE B: raw_arg
    println!("Trying Variante B: raw_arg");
    let raw_command = format!(r#"start "NoorSigner-B" cmd /k "{}" {}"#, noorsigner_path.display(), cmd);
    let _ = Command::new("cmd")
        .arg("/c")
        .raw_arg(&raw_command)
        .spawn();

    // VARIANTE C: Batch-Datei
    println!("Trying Variante C: batch file");
    let temp_dir = std::env::temp_dir();
    let bat_path = temp_dir.join("noorsigner_launch.bat");
    let bat_content = format!(
        "@echo off\r\n\"{}\" {}\r\n",
        noorsigner_path.display(),
        cmd
    );
    if std::fs::write(&bat_path, &bat_content).is_ok() {
        let _ = Command::new("cmd")
            .args(["/c", "start", "NoorSigner-C", "cmd", "/k", bat_path.to_str().unwrap()])
            .spawn();
    }

    println!("NoorSigner launched successfully");
    Ok(())
}
