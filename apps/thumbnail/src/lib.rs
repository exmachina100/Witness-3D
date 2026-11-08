//! Explorer thumbnails for `.w3d` files (Plasticity installs `thumbnail_provider.dll` for its own
//! files). A `.w3d` file keeps a small PNG of the model near its top (see `w3d_kernel::file`), so
//! the handler reads only the start of the file, decodes that PNG with Windows Imaging and hands
//! Explorer a bitmap. The installer registers it with `regsvr32` (DllRegisterServer).
//!
//! Finding and decoding the preview is plain Rust and tested on every platform; the COM parts
//! build on Windows only.

/// How far into a file the preview may start: it comes right after the format and version.
const KEY_WITHIN: usize = 256;
/// The most a handler reads of a file looking for the end of the preview.
pub const HEAD_LIMIT: usize = 4 << 20;

/// The preview PNG's bytes from the start of a `.w3d` file, or `None` when it has none.
pub fn preview_png(head: &[u8]) -> Option<Vec<u8>> {
    if !head.starts_with(b"{\"format\":\"witness3d\"") { return None }
    let key = b"\"preview\":\"data:image/png;base64,";
    let at = head[..head.len().min(KEY_WITHIN + key.len())].windows(key.len()).position(|w| w == key)? + key.len();
    let end = head[at..].iter().position(|&b| b == b'"')?;
    let png = base64(&head[at..at + end])?;
    png.starts_with(b"\x89PNG\r\n\x1a\n").then_some(png)
}

/// Whether `head` already holds the whole preview (or shows there is none), so reading can stop.
pub fn head_is_enough(head: &[u8]) -> bool {
    if head.len() < KEY_WITHIN + 40 { return false }
    let key = b"\"preview\":\"";
    match head[..KEY_WITHIN + key.len()].windows(key.len()).position(|w| w == key) {
        None => true,
        Some(at) => head[at + key.len()..].contains(&b'"'),
    }
}

/// Standard base64 (with or without padding); `None` on any other character.
fn base64(text: &[u8]) -> Option<Vec<u8>> {
    let value = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let text: &[u8] = match text.iter().rposition(|&c| c != b'=') { Some(i) => &text[..=i], None => &[] };
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    for chunk in text.chunks(4) {
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() { n |= value(c)? << (18 - 6 * i) }
        let bytes = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        match chunk.len() {
            4 => out.extend_from_slice(&bytes),
            3 => out.extend_from_slice(&bytes[..2]),
            2 => out.push(bytes[0]),
            _ => return None,
        }
    }
    Some(out)
}

#[cfg(windows)]
mod com;

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    #[test]
    fn the_preview_is_read_from_the_top_of_the_file() {
        let file = format!("{{\"format\":\"witness3d\",\"version\":1,\"preview\":\"data:image/png;base64,{PNG_B64}\",\"units\":\"mm\",\"bodies\":[]}}");
        let png = preview_png(file.as_bytes()).unwrap();
        assert!(png.starts_with(b"\x89PNG"));
        assert_eq!(png.len(), 70);
        assert!(head_is_enough(format!("{file}{}", " ".repeat(300)).as_bytes()));
    }

    #[test]
    fn other_files_and_odd_previews_give_none() {
        assert_eq!(preview_png(b"{\"format\":\"other\",\"preview\":\"data:image/png;base64,AAAA\"}"), None);
        assert_eq!(preview_png(b"{\"format\":\"witness3d\",\"version\":1,\"units\":\"mm\"}"), None);
        // Not a PNG once decoded, or not base64 at all.
        assert_eq!(preview_png(b"{\"format\":\"witness3d\",\"version\":1,\"preview\":\"data:image/png;base64,AAAA\"}"), None);
        assert_eq!(preview_png(b"{\"format\":\"witness3d\",\"version\":1,\"preview\":\"data:image/png;base64,**\"}"), None);
        // Far down the file (inside a body, say) doesn't count.
        let late = format!("{{\"format\":\"witness3d\",\"version\":1,{}\"preview\":\"data:image/png;base64,{PNG_B64}\"}}", " ".repeat(400));
        assert_eq!(preview_png(late.as_bytes()), None);
        assert!(head_is_enough(late.as_bytes()), "no preview up top: stop reading");
    }

    #[test]
    fn base64_with_and_without_padding() {
        assert_eq!(base64(b"TWFu").unwrap(), b"Man");
        assert_eq!(base64(b"TWE=").unwrap(), b"Ma");
        assert_eq!(base64(b"TWE").unwrap(), b"Ma");
        assert_eq!(base64(b"TQ==").unwrap(), b"M");
        assert_eq!(base64(b"T"), None);
    }
}
