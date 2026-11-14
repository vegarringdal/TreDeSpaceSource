//! Probe: marker8 stream shape of the winning fragment chunk (root routing).
use nwd_core::{fragments, Container};

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let c = Container::parse(&bytes).unwrap();
    let mut best: Vec<fragments::Fragment> = Vec::new();
    for i in 0..c.chunks.len() {
        let data = c.data(i);
        let f = fragments::placements(&data);
        if f.len() > best.len() {
            best = f;
        }
    }
    println!("fragments: {}", best.len());
    // Coalesce marker8 into runs.
    let mut runs: Vec<(u32, usize)> = Vec::new();
    for fr in &best {
        match runs.last_mut() {
            Some((v, n)) if Some(*v) == fr.marker8 => *n += 1,
            _ => runs.push((fr.marker8.unwrap_or(u32::MAX), 1)),
        }
    }
    println!("runs: {}", runs.len());
    for (v, n) in runs.iter().take(40) {
        println!("  m8={v}  x{n}");
    }
    let distinct: std::collections::HashSet<u32> = best.iter().filter_map(|f| f.marker8).collect();
    println!("distinct marker8 values: {}", distinct.len());
    let with_group = best.iter().filter(|f| f.group.is_some()).count();
    println!("with group: {} / {}", with_group, best.len());
    let gmin = best.iter().filter_map(|f| f.group).min();
    let gmax = best.iter().filter_map(|f| f.group).max();
    println!("group range: {:?}..{:?}", gmin, gmax);
    let dg: std::collections::HashSet<u32> = best.iter().filter_map(|f| f.group).collect();
    println!("distinct groups: {}", dg.len());
}
