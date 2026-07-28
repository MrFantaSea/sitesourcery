#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: install-reviewed-chromium.sh INSTALL_ROOT GITHUB_ENV_FILE" >&2
  exit 64
fi

install_root="$1"
github_env_file="$2"
archive_url="https://storage.googleapis.com/chrome-for-testing-public/149.0.7827.55/linux64/chrome-headless-shell-linux64.zip"
archive_sha256="410c9407d5de3fea80d9398666be06f2aa09154a3fa7b327dc254e336bb4c4b7"
expected_version="Google Chrome for Testing 149.0.7827.55"
archive="$install_root.zip"
binary="$install_root/chrome-headless-shell-linux64/chrome-headless-shell"

test -n "$install_root"
test -n "$github_env_file"
test ! -e "$install_root"
test ! -e "$archive"
mkdir -p "$(dirname "$install_root")"

curl \
  --proto '=https' \
  --tlsv1.2 \
  --fail-with-body \
  --silent \
  --show-error \
  --location \
  "$archive_url" \
  --output "$archive"

observed_sha256="$(sha256sum "$archive" | awk '{print $1}')"
test "$observed_sha256" = "$archive_sha256"

mkdir "$install_root"
unzip -q "$archive" -d "$install_root"
test -x "$binary"
test "$("$binary" --version)" = "$expected_version"

printf 'SITESOURCERY_CHROMIUM=%s\n' "$binary" >> "$github_env_file"
