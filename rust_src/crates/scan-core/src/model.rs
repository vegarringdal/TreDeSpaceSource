//! Format-neutral types shared by the E57 and LGSX readers — what a viewer
//! or cooker consumes: setups (scan positions) with poses, panorama images,
//! and point batches.

use serde::Serialize;

/// Rigid transform: unit quaternion rotation followed by translation
/// (`p' = R·p + t`), the E57 convention.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Pose {
    /// Quaternion as `[w, x, y, z]`.
    pub rotation: [f64; 4],
    pub translation: [f64; 3],
}

impl Default for Pose {
    fn default() -> Self {
        Pose::IDENTITY
    }
}

impl Pose {
    pub const IDENTITY: Pose = Pose {
        rotation: [1.0, 0.0, 0.0, 0.0],
        translation: [0.0; 3],
    };

    pub fn is_identity(&self) -> bool {
        *self == Pose::IDENTITY
    }

    /// Row-major 3×3 rotation matrix (the quaternion is normalised first).
    pub fn matrix3(&self) -> [[f64; 3]; 3] {
        let [w, x, y, z] = self.rotation;
        let n = (w * w + x * x + y * y + z * z).sqrt();
        let (w, x, y, z) = if n > 0.0 {
            (w / n, x / n, y / n, z / n)
        } else {
            (1.0, 0.0, 0.0, 0.0)
        };
        [
            [
                1.0 - 2.0 * (y * y + z * z),
                2.0 * (x * y - w * z),
                2.0 * (x * z + w * y),
            ],
            [
                2.0 * (x * y + w * z),
                1.0 - 2.0 * (x * x + z * z),
                2.0 * (y * z - w * x),
            ],
            [
                2.0 * (x * z - w * y),
                2.0 * (y * z + w * x),
                1.0 - 2.0 * (x * x + y * y),
            ],
        ]
    }

    /// Column-major 4×4 matrix (glTF / WebGPU order).
    pub fn matrix4(&self) -> [f64; 16] {
        let r = self.matrix3();
        let t = self.translation;
        [
            r[0][0], r[1][0], r[2][0], 0.0, //
            r[0][1], r[1][1], r[2][1], 0.0, //
            r[0][2], r[1][2], r[2][2], 0.0, //
            t[0], t[1], t[2], 1.0,
        ]
    }

    pub fn apply(&self, p: [f64; 3]) -> [f64; 3] {
        let r = self.matrix3();
        let t = self.translation;
        [
            r[0][0] * p[0] + r[0][1] * p[1] + r[0][2] * p[2] + t[0],
            r[1][0] * p[0] + r[1][1] * p[1] + r[1][2] * p[2] + t[1],
            r[2][0] * p[0] + r[2][1] * p[1] + r[2][2] * p[2] + t[2],
        ]
    }

    /// `self ∘ other`: apply `other` first, then `self`.
    pub fn compose(&self, other: &Pose) -> Pose {
        let [aw, ax, ay, az] = self.rotation;
        let [bw, bx, by, bz] = other.rotation;
        let rotation = [
            aw * bw - ax * bx - ay * by - az * bz,
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
        ];
        Pose {
            rotation,
            translation: self.apply(other.translation),
        }
    }

    pub fn inverse(&self) -> Pose {
        let [w, x, y, z] = self.rotation;
        let inv = Pose {
            rotation: [w, -x, -y, -z],
            translation: [0.0; 3],
        };
        let t = inv.apply(self.translation);
        Pose {
            rotation: inv.rotation,
            translation: [-t[0], -t[1], -t[2]],
        }
    }
}

/// Axis-aligned bounds.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Aabb {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

impl Aabb {
    pub const EMPTY: Aabb = Aabb {
        min: [f64::INFINITY; 3],
        max: [f64::NEG_INFINITY; 3],
    };

    pub fn is_empty(&self) -> bool {
        self.min[0] > self.max[0]
    }
    pub fn add(&mut self, p: [f64; 3]) {
        for (k, v) in p.into_iter().enumerate() {
            self.min[k] = self.min[k].min(v);
            self.max[k] = self.max[k].max(v);
        }
    }
    pub fn union(&mut self, o: &Aabb) {
        if !o.is_empty() {
            self.add(o.min);
            self.add(o.max);
        }
    }
    pub fn contains(&self, p: [f64; 3]) -> bool {
        (0..3).all(|k| p[k] >= self.min[k] && p[k] <= self.max[k])
    }
}

/// Image container format of an encoded image.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Jpeg,
    Png,
    /// JPEG XR / HD Photo (`II\xBC\x01`) — LGSX depth cubes.
    JpegXr,
}

impl ImageFormat {
    pub fn sniff(head: &[u8]) -> Option<ImageFormat> {
        if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some(ImageFormat::Jpeg)
        } else if head.starts_with(b"\x89PNG") {
            Some(ImageFormat::Png)
        } else if head.starts_with(b"II\xBC") {
            Some(ImageFormat::JpegXr)
        } else {
            None
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Png => "png",
            ImageFormat::JpegXr => "jxr",
        }
    }
}

/// One decoded batch of points. Positions are `f64` in the source's project
/// frame (E57: the scan's local frame unless the reader was asked to apply
/// the scan pose; LGSX: the project frame of the registration).
#[derive(Clone, Debug, Default)]
pub struct PointBatch {
    pub positions: Vec<[f64; 3]>,
    /// 8-bit RGB, when the source has colour.
    pub colors: Option<Vec<[u8; 3]>>,
    /// Intensity normalised to `0..=1`, when present.
    pub intensity: Option<Vec<f32>>,
    /// Index of the setup / scan each point came from, when known.
    pub setup: Option<Vec<u16>>,
}

impl PointBatch {
    pub fn len(&self) -> usize {
        self.positions.len()
    }
    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }
}

const H: f64 = std::f64::consts::FRAC_1_SQRT_2;

/// Cube-map face convention shared by the LGSX `CUBE` sections and the
/// pinhole cube faces Leica writes to E57.
///
/// Index = LGSX face order. Each face is a 90° pinhole camera that looks
/// down its local −Z with +X right and +Y up in the image (the E57 pinhole
/// convention); `rotation` maps camera → setup frame (setup frame is Z-up).
/// Validated: all 14 × 6 faces of the Piazza sample reproduce the E57 image
/// poses to 4e-16 as `data3D_pose ∘ setup_pose ∘ face`.
pub const CUBE_FACES: [CubeFace; 6] = [
    CubeFace {
        name: "+Y",
        view: [0.0, 1.0, 0.0],
        rotation: [H, H, 0.0, 0.0],
    },
    CubeFace {
        name: "-Y",
        view: [0.0, -1.0, 0.0],
        rotation: [0.0, 0.0, H, H],
    },
    CubeFace {
        name: "-X",
        view: [-1.0, 0.0, 0.0],
        rotation: [0.5, 0.5, 0.5, 0.5],
    },
    CubeFace {
        name: "+X",
        view: [1.0, 0.0, 0.0],
        rotation: [0.5, 0.5, -0.5, -0.5],
    },
    CubeFace {
        name: "+Z",
        view: [0.0, 0.0, 1.0],
        rotation: [0.0, 1.0, 0.0, 0.0],
    },
    CubeFace {
        name: "-Z",
        view: [0.0, 0.0, -1.0],
        rotation: [1.0, 0.0, 0.0, 0.0],
    },
];

#[derive(Clone, Copy, Debug, Serialize)]
pub struct CubeFace {
    pub name: &'static str,
    /// Viewing direction in the setup frame.
    pub view: [f64; 3],
    /// Camera → setup rotation `[w, x, y, z]`.
    pub rotation: [f64; 4],
}

impl CubeFace {
    pub fn pose(&self) -> Pose {
        Pose {
            rotation: self.rotation,
            translation: [0.0; 3],
        }
    }
}
