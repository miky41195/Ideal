//! LSP base-protocol framing: `Content-Length: N\r\n\r\n<body>`.

const SEP: &[u8] = b"\r\n\r\n";
/// Bodies larger than this are treated as a malformed header and skipped.
const MAX_BODY: usize = 256 * 1024 * 1024;

pub fn encode(msg: &str) -> Vec<u8> {
    let mut out = format!("Content-Length: {}\r\n\r\n", msg.len()).into_bytes();
    out.extend_from_slice(msg.as_bytes());
    out
}

/// Incremental decoder: feed it whatever the server wrote, get complete bodies back.
#[derive(Default)]
pub struct Decoder {
    buf: Vec<u8>,
}

fn find_sep(buf: &[u8]) -> Option<usize> {
    buf.windows(SEP.len()).position(|w| w == SEP)
}

fn content_length(header: &str) -> Option<usize> {
    for line in header.split("\r\n") {
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                return value.trim().parse().ok();
            }
        }
    }
    None
}

impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let Some(h_end) = find_sep(&self.buf) else { break };
            let header = String::from_utf8_lossy(&self.buf[..h_end]).into_owned();
            let body_start = h_end + SEP.len();
            match content_length(&header) {
                Some(len) if len <= MAX_BODY => {
                    if self.buf.len() < body_start + len {
                        break; // wait for the rest of the body
                    }
                    let body: Vec<u8> = self.buf[body_start..body_start + len].to_vec();
                    self.buf.drain(..body_start + len);
                    if let Ok(s) = String::from_utf8(body) {
                        out.push(s);
                    }
                }
                _ => {
                    // No usable Content-Length: skip this header block.
                    self.buf.drain(..body_start);
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(body: &str) -> Vec<u8> {
        encode(body)
    }

    #[test]
    fn encode_has_byte_length() {
        let out = String::from_utf8(encode("\u{e8}")).unwrap();
        assert_eq!(out, "Content-Length: 2\r\n\r\n\u{e8}");
    }

    #[test]
    fn decode_split_header() {
        let mut d = Decoder::default();
        let f = frame("{\"a\":1}");
        assert!(d.push(&f[..5]).is_empty());
        assert!(d.push(&f[5..19]).is_empty());
        assert_eq!(d.push(&f[19..]), vec!["{\"a\":1}".to_string()]);
    }

    #[test]
    fn decode_two_frames_one_push() {
        let mut d = Decoder::default();
        let mut b = frame("one");
        b.extend(frame("two"));
        assert_eq!(d.push(&b), vec!["one".to_string(), "two".to_string()]);
    }

    #[test]
    fn decode_partial_body() {
        let mut d = Decoder::default();
        let f = frame("hello world");
        let cut = f.len() - 4;
        assert!(d.push(&f[..cut]).is_empty());
        assert_eq!(d.push(&f[cut..]), vec!["hello world".to_string()]);
    }

    #[test]
    fn decode_multibyte_body_split_mid_char() {
        let mut d = Decoder::default();
        let f = frame("a\u{e8}b");
        let cut = f.len() - 2; // inside the two-byte char
        assert!(d.push(&f[..cut]).is_empty());
        assert_eq!(d.push(&f[cut..]), vec!["a\u{e8}b".to_string()]);
    }

    #[test]
    fn decode_extra_headers_case_insensitive() {
        let mut d = Decoder::default();
        let raw = b"content-type: application/vscode-jsonrpc; charset=utf-8\r\nCONTENT-LENGTH: 2\r\n\r\nhi";
        assert_eq!(d.push(raw), vec!["hi".to_string()]);
    }

    #[test]
    fn decode_invalid_utf8_dropped() {
        let mut d = Decoder::default();
        let mut b = b"Content-Length: 2\r\n\r\n".to_vec();
        b.extend([0xff, 0xfe]);
        b.extend(frame("ok"));
        assert_eq!(d.push(&b), vec!["ok".to_string()]);
    }

    #[test]
    fn decode_header_without_length_skipped() {
        let mut d = Decoder::default();
        let mut b = b"X-Foo: bar\r\n\r\n".to_vec();
        b.extend(frame("ok"));
        assert_eq!(d.push(&b), vec!["ok".to_string()]);
    }
}
