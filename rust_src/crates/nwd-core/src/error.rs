//! Error type for the NWD reader.

use std::fmt;

#[derive(Debug)]
pub enum Error {
    /// The file does not start with a recognised `#LcUStream` signature.
    BadSignature(String),
    /// Hit the end of the buffer while a reader still expected bytes.
    UnexpectedEof { context: &'static str },
    /// A zlib stream failed to inflate.
    Inflate(String),
    /// Structural assumption violated while decoding a stream.
    Decode(String),
    /// Wrapped std::io error.
    Io(std::io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::BadSignature(s) => write!(f, "bad NWD signature: {s}"),
            Error::UnexpectedEof { context } => {
                write!(f, "unexpected end of data while reading {context}")
            }
            Error::Inflate(s) => write!(f, "zlib inflate failed: {s}"),
            Error::Decode(s) => write!(f, "decode error: {s}"),
            Error::Io(e) => write!(f, "io error: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, Error>;
