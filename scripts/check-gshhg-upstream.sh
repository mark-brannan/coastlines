#!/usr/bin/env bash
# Does the GSHHG zip upstream still match the one coastlines mirrors?
#
#   bash scripts/check-gshhg-upstream.sh    (Linux: Debian CA path, GNU stat and sort)
#
# sync fetches the zip from this repository's data release (manifest.json
# sources.gshhg.url), so a slow or broken upstream host no longer breaks CI.
# This script asks the upstream site instead, and prints one of three verdicts:
#
#   same         upstream serves the pinned version, byte for byte: keep the mirror
#   changed      upstream's newest zip is a new version, or the pinned one's bytes
#                moved: a release candidate to look at, never adopted automatically
#   unreachable  the site or the zip could not be fetched: says nothing about the data
#
# Exit status is 0 for every verdict; 2 only when the script itself is broken.
# In GitHub Actions the verdict and the candidate go to $GITHUB_OUTPUT and the
# step summary, and on "changed" the issue body to $RUNNER_TEMP/gshhg-issue.md.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

read -r version bytes sha256 site < <(node -e "
  const g = require('$root/manifest.json').sources.gshhg;
  for (const k of ['version', 'bytes', 'sha256', 'site']) if (g[k] == null) throw new Error('sources.gshhg.' + k + ' missing');
  console.log(g.version, g.bytes, g.sha256.replace(/^sha256:/, ''), g.site);") \
  || { echo "cannot read sources.gshhg from manifest.json" >&2; exit 2; }

out() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "$1=$2" >>"$GITHUB_OUTPUT"
    echo "- $1: $2" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
  fi
  echo "$1: $2"
}

# The upstream host has served its certificate without the emSign intermediate
# (curl: unable to get local issuer certificate). Fetch that intermediate from
# its AIA URL and trust it alongside the system store. The AIA URL is plain HTTP
# and curl treats every certificate in --cacert as an anchor, so the file is
# trusted only when its sha256 matches the pin; otherwise, or if the fetch fails,
# try with the system store alone.
EMSIGN_P7C_SHA256=11c02b4b591a54aa057621e97e3aab79889c2d8ee3af50fdd3fcfa0fa6738521
bundle="$work/ca.pem"
cat /etc/ssl/certs/ca-certificates.crt >"$bundle"
if curl -fsS --connect-timeout 10 --max-time 20 -o "$work/em.p7c" \
  http://repository.emsign.com/certs/EMIncommonOVG2C.p7c; then
  if [[ "$(sha256sum "$work/em.p7c" | cut -d' ' -f1)" == "$EMSIGN_P7C_SHA256" ]]; then
    openssl pkcs7 -inform DER -in "$work/em.p7c" -print_certs >>"$bundle" || true
  else
    echo "::warning::emSign intermediate does not match its pin; using the system store alone."
  fi
fi

# Bounded so a hung host reads as unreachable before the workflow's job timeout
# fires: 20 + 30 + 150 s at most, against ~37 s measured for a whole run.
get() { local max=$1; shift; curl -fsSL --cacert "$bundle" --connect-timeout 20 --max-time "$max" "$@"; }

unreachable() {
  out verdict unreachable
  echo "::warning::GSHHG upstream unreachable ($1). This is not a change to the data; the mirror stands."
  exit 0
}

get 30 -o "$work/index.html" "$site" || unreachable "$site"
newest=$(grep -o 'gshhg-shp-[0-9][0-9.]*[0-9]\.zip' "$work/index.html" | sort -uV | tail -1 || true)
[[ -n "$newest" ]] || { echo "no gshhg-shp-*.zip link on $site" >&2; exit 2; }
candidate=${newest#gshhg-shp-}
candidate=${candidate%.zip}

zip_url="${site%/}/$newest"
get 150 -o "$work/$newest" "$zip_url" || unreachable "$zip_url"
got_bytes=$(stat -c %s "$work/$newest")
got_sha256=$(sha256sum "$work/$newest" | cut -d' ' -f1)

out pinned "$version"
out candidate "$candidate"
out url "$zip_url"
out bytes "$got_bytes"
out sha256 "$got_sha256"
if [[ "$candidate" == "$version" && "$got_bytes" == "$bytes" && "$got_sha256" == "$sha256" ]]; then
  out verdict same
  exit 0
fi
out verdict changed

# The issue the workflow files on "changed": its title (the dedupe key) and body.
out title "GSHHG upstream changed: $candidate, sha256 ${got_sha256:0:12}"
[[ -n "${GITHUB_ACTIONS:-}" ]] || exit 0
run="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
cat >"$RUNNER_TEMP/gshhg-issue.md" <<EOF
Upstream GSHHG no longer matches the mirrored pin, found by $run.

| | version | bytes | sha256 |
|---|---|---|---|
| pinned (manifest.json) | $version | $bytes | \`$sha256\` |
| upstream candidate | $candidate | $got_bytes | \`$got_sha256\` |

Upstream zip: $zip_url

A release candidate, not adopted. To try it: download the zip, upload it to a
new \`data-gshhg-$candidate\` prerelease, point manifest.json sources.gshhg at
that asset with these bytes and sha256 (\`npm run sync:refresh\` re-pins the
entries), and open a PR whose CI and diff decide whether it is a valid update.
EOF
