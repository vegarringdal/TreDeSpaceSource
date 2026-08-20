//! Lightweight STEP scan for the element-to-element relationships the spatial tree does
//! not carry, so the treeview hierarchy can parent every element correctly:
//!
//! - `IFCRELAGGREGATES` / `IFCRELNESTS` — element decomposition (curtain-wall members,
//!   stair flights, …): `RelatingObject` is the parent of each `RelatedObjects` entry.
//! - `IFCRELVOIDSELEMENT` — an opening's parent is its host element.
//! - `IFCRELFILLSELEMENT` — a door/window's parent is the opening it fills.
//!
//! Chained (`door → opening → wall`), and with the wall itself spatially contained, every
//! such element resolves to the right storey. This is a plain byte scan of the STEP text
//! (no full decode): find `#id=IFCREL…(`, split the top-level attributes respecting
//! strings/parens, and pull the `#refs`.

use std::collections::HashMap;

/// Scan raw IFC bytes and return `child → parent` links from the aggregation / voiding /
/// filling relationships. Spatial containment is NOT included (the spatial tree owns it).
pub fn parse_parent_links(ifc: &[u8]) -> HashMap<u32, u32> {
    let mut links: HashMap<u32, u32> = HashMap::new();
    // (entity token, relating-attr index, related-attr index, related-is-list)
    const RELS: [(&[u8], usize, usize); 4] = [
        (b"IFCRELAGGREGATES(", 4, 5),
        (b"IFCRELNESTS(", 4, 5),
        (b"IFCRELVOIDSELEMENT(", 4, 5),
        (b"IFCRELFILLSELEMENT(", 4, 5),
    ];

    let mut pos = 0usize;
    // Match `= IFCREL…` with optional whitespace after the `=` (writers differ: some emit
    // `#id=IFCREL…`, others `#id= IFCREL…`).
    while let Some(eq) = find_byte(ifc, b'=', pos) {
        pos = eq + 1;
        let mut t = eq + 1;
        while t < ifc.len() && matches!(ifc[t], b' ' | b'\t') {
            t += 1;
        }
        let after = &ifc[t..];
        if after.len() < 7 || !after[..6].eq_ignore_ascii_case(b"IFCREL") {
            continue;
        }
        for &(tok, relating_i, related_i) in &RELS {
            if after.len() >= tok.len() && after[..tok.len()].eq_ignore_ascii_case(tok) {
                let args_start = t + tok.len();
                if let Some(args) = entity_args(ifc, args_start) {
                    let attrs = split_top_level(args);
                    if attrs.len() > related_i {
                        let parent = first_ref(attrs[relating_i]);
                        if let Some(parent) = parent {
                            for child in all_refs(attrs[related_i]) {
                                links.insert(child, parent);
                            }
                        }
                    }
                }
                break;
            }
        }
    }
    links
}

/// Scan for `#id=IFCTYPE(` headers and return the type name for each id in `wanted`.
/// Used to label hierarchy entries for parents that carry no mesh of their own.
pub fn entity_types(ifc: &[u8], wanted: &std::collections::HashSet<u32>) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    if wanted.is_empty() {
        return out;
    }
    let mut pos = 0usize;
    while pos < ifc.len() {
        // Find the next `#` that starts a line-ish position (after ; or newline or start).
        let Some(h) = find_byte(ifc, b'#', pos) else {
            break;
        };
        pos = h + 1;
        if h > 0 && !matches!(ifc[h - 1], b';' | b'\n' | b'\r' | b' ' | b'\t') {
            continue;
        }
        let (id, after_id) = match read_u32(ifc, h + 1) {
            Some(v) => v,
            None => continue,
        };
        if !wanted.contains(&id) || out.contains_key(&id) {
            continue;
        }
        let mut i = after_id;
        while i < ifc.len() && matches!(ifc[i], b' ' | b'\t') {
            i += 1;
        }
        if i >= ifc.len() || ifc[i] != b'=' {
            continue;
        }
        i += 1;
        while i < ifc.len() && matches!(ifc[i], b' ' | b'\t') {
            i += 1;
        }
        let start = i;
        while i < ifc.len() && (ifc[i].is_ascii_alphanumeric() || ifc[i] == b'_') {
            i += 1;
        }
        if i > start {
            out.insert(id, String::from_utf8_lossy(&ifc[start..i]).into_owned());
            if out.len() == wanted.len() {
                break;
            }
        }
    }
    out
}

// ── scanning helpers ─────────────────────────────────────────────────────────

fn find_byte(hay: &[u8], b: u8, from: usize) -> Option<usize> {
    hay[from.min(hay.len())..]
        .iter()
        .position(|&c| c == b)
        .map(|p| p + from)
}

/// The argument slice between the opening paren at `start-1`.. and its matching `)`,
/// respecting STEP strings (`'…'`, with `''` escapes) and nested parens.
fn entity_args(ifc: &[u8], start: usize) -> Option<&[u8]> {
    let mut depth = 1i32;
    let mut i = start;
    let mut in_str = false;
    while i < ifc.len() {
        let c = ifc[i];
        if in_str {
            if c == b'\'' {
                in_str = false;
            }
        } else {
            match c {
                b'\'' => in_str = true,
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&ifc[start..i]);
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

/// Split `args` on top-level commas (depth 0, outside strings).
fn split_top_level(args: &[u8]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut in_str = false;
    let mut start = 0usize;
    for (i, &c) in args.iter().enumerate() {
        if in_str {
            if c == b'\'' {
                in_str = false;
            }
            continue;
        }
        match c {
            b'\'' => in_str = true,
            b'(' => depth += 1,
            b')' => depth -= 1,
            b',' if depth == 0 => {
                out.push(&args[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(&args[start..]);
    out
}

/// First `#123` reference in `s`.
fn first_ref(s: &[u8]) -> Option<u32> {
    let h = find_byte(s, b'#', 0)?;
    read_u32(s, h + 1).map(|(v, _)| v)
}

/// Every `#123` reference in `s`.
fn all_refs(s: &[u8]) -> Vec<u32> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while let Some(h) = find_byte(s, b'#', pos) {
        if let Some((v, next)) = read_u32(s, h + 1) {
            out.push(v);
            pos = next;
        } else {
            pos = h + 1;
        }
    }
    out
}

fn read_u32(s: &[u8], from: usize) -> Option<(u32, usize)> {
    let mut i = from;
    let mut v: u64 = 0;
    while i < s.len() && s[i].is_ascii_digit() {
        v = v * 10 + (s[i] - b'0') as u64;
        if v > u32::MAX as u64 {
            return None;
        }
        i += 1;
    }
    if i == from { None } else { Some((v as u32, i)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IFC: &[u8] = b"ISO-10303-21;
#100=IFCCURTAINWALL('guid',#2,'CW',$,$,#10,#11,$);
#200=IFCRELAGGREGATES('g',#2,$,$,#100,(#201,#202,#203));
#300=IFCWALLSTANDARDCASE('g',#2,'W (a,b)',$,$,#10,#11,$);
#301=IFCOPENINGELEMENT('g',#2,$,$,$,#10,#11,$);
#302=IFCDOOR('g',#2,'D''oor',$,$,#10,#11,$,1.0,2.0);
#400=IFCRELVOIDSELEMENT('g',#2,$,$,#300,#301);
#401=IFCRELFILLSELEMENT('g',#2,$,$,#301,#302);
ENDSEC;";

    #[test]
    fn parses_aggregates_voids_fills() {
        let links = parse_parent_links(IFC);
        assert_eq!(links.get(&201), Some(&100));
        assert_eq!(links.get(&202), Some(&100));
        assert_eq!(links.get(&203), Some(&100));
        assert_eq!(links.get(&301), Some(&300)); // opening -> wall
        assert_eq!(links.get(&302), Some(&301)); // door -> opening
        assert_eq!(links.len(), 5);
    }

    #[test]
    fn parses_space_after_equals_format() {
        // Some writers (e.g. ArchiCAD exports) put a space after `=`.
        let ifc: &[u8] = b"#145878= IFCRELVOIDSELEMENT('g',#12,$,$,#145201,#145875);\n\
#149682= IFCRELFILLSELEMENT('g',#12,$,$,#145875,#149679);\n";
        let links = parse_parent_links(ifc);
        assert_eq!(links.get(&145875), Some(&145201)); // opening -> host wall
        assert_eq!(links.get(&149679), Some(&145875)); // window -> opening
    }

    #[test]
    fn entity_types_labels_wanted_ids() {
        let wanted: std::collections::HashSet<u32> = [100, 301].into_iter().collect();
        let types = entity_types(IFC, &wanted);
        assert_eq!(types.get(&100).map(String::as_str), Some("IFCCURTAINWALL"));
        assert_eq!(
            types.get(&301).map(String::as_str),
            Some("IFCOPENINGELEMENT")
        );
    }
}
