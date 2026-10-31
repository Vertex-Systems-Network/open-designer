//! Keep WebKitGTK from disconnecting a Wayland session on NVIDIA.
//!
//! Disabling explicit sync alone does not stop WebKitGTK from selecting a hardware
//! DMABUF renderer. For the proprietary NVIDIA driver, forcing shared memory keeps
//! WebKitGTK from using the affected transport. These variables are set before
//! Tauri creates the webview.

use std::path::Path;

const NV_DISABLE_EXPLICIT_SYNC: &str = "__NV_DISABLE_EXPLICIT_SYNC";
const WEBKIT_DMABUF_RENDERER_FORCE_SHM: &str = "WEBKIT_DMABUF_RENDERER_FORCE_SHM";
const NVIDIA_VERSION_FILE: &str = "/proc/driver/nvidia/version";

/// Apply workarounds only after explicit opt-in and when the proprietary NVIDIA driver
/// is loaded. Existing workaround values, including empty values, belong to the user.
#[cfg(target_os = "linux")]
pub fn disable_nvidia_explicit_sync() {
    if std::env::var_os("OPENDESIGNER_NVIDIA_WAYLAND_WORKAROUND").as_deref()
        != Some(std::ffi::OsStr::new("1"))
        || !Path::new(NVIDIA_VERSION_FILE).is_file()
    {
        return;
    }

    for variable in [NV_DISABLE_EXPLICIT_SYNC, WEBKIT_DMABUF_RENDERER_FORCE_SHM] {
        if std::env::var_os(variable).is_none() {
            std::env::set_var(variable, "1");
        }
    }
}
