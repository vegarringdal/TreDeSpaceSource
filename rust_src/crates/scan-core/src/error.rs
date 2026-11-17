use std::fmt;

#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    /// A read ran past the end of the source.
    Eof {
        offset: u64,
        len: u64,
    },
    /// The bytes do not match the expected structure.
    Format(String),
    /// A page / section checksum did not match.
    Checksum {
        what: &'static str,
        offset: u64,
    },
    /// Structurally valid but uses a feature this reader does not decode.
    Unsupported(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(e) => write!(f, "I/O error: {e}"),
            Error::Eof { offset, len } => {
                write!(
                    f,
                    "read of {len} bytes at offset {offset} runs past the end of the input"
                )
            }
            Error::Format(s) => write!(f, "format error: {s}"),
            Error::Checksum { what, offset } => {
                write!(f, "{what} checksum mismatch at offset {offset}")
            }
            Error::Unsupported(s) => write!(f, "unsupported: {s}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            Error::Eof { offset: 0, len: 0 }
        } else {
            Error::Io(e)
        }
    }
}

pub(crate) fn fmt_err<T>(msg: impl Into<String>) -> Result<T> {
    Err(Error::Format(msg.into()))
}
