#!/usr/bin/env bash
# Download large real-world IFC models for stress-testing. These are too big to keep in
# git history, so they live here only after you run this script (they are git-ignored).
# Source: ThatOpen/engine_web-ifc public test corpus.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
base="https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/main/tests/ifcfiles/public"

# name : remote file
models=(
  "dental_clinic.ifc:dental_clinic.ifc"               # ~13 MB medical/clinic building (IFC2X3)
  "FM_ARC_DigitalHub.ifc:FM_ARC_DigitalHub.ifc"       # ~14 MB office / facility
  "C20-Institute-Var-2.ifc:C20-Institute-Var-2.ifc"   # ~11 MB institute building
  # Bigger still (uncomment if you want them):
  # "advanced_model.ifc:advanced_model.ifc"           # ~34 MB
  # "schependomlaan.ifc:schependomlaan.ifc"           # ~48 MB (the classic house model)
  # "ISSUE_068_ARK_NUS_skolebygg.ifc:ISSUE_068_ARK_NUS_skolebygg.ifc" # ~56 MB school
)

for m in "${models[@]}"; do
  out="${m%%:*}"; remote="${m##*:}"
  if [ -f "$here/$out" ]; then echo "have  $out"; continue; fi
  echo "get   $out"
  curl -fL --max-time 600 -o "$here/$out" "$base/$remote" \
    && echo "  ok  $(du -h "$here/$out" | cut -f1)" \
    || { echo "  FAILED"; rm -f "$here/$out"; }
done
