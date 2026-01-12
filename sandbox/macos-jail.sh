#!/bin/bash
set -e

PROJECT_DIR=$1

if [ -z "$PROJECT_DIR" ]; then
    echo "Usage: $0 <project_directory>"
    exit 1
fi

PROJECT_DIR=$(realpath "$PROJECT_DIR")

# Create temporary sandbox directory
SANDBOX_DIR=$(mktemp -d /tmp/gemini-sandbox-XXXXXX)
echo "Creating sandbox at $SANDBOX_DIR..."

# Cleanup trap
cleanup() {
    echo "Cleaning up..."
    # Ask user before deleting? The spec says optional: ask user.
    # For automation, we usually skip asking or default to yes.
    # The spec says "Use trap to delete... (optional: ask user)".
    # I'll just delete for now to be safe and clean.
    rm -rf "$SANDBOX_DIR"
    if [ -n "$PROFILE_PATH" ]; then
        rm -f "$PROFILE_PATH"
    fi
}
trap cleanup EXIT

# APFS Clone (cp -Rc)
# Copy the contents of PROJECT_DIR into SANDBOX_DIR
# We want SANDBOX_DIR to look like PROJECT_DIR.
# If PROJECT_DIR is ~/my-project, we want SANDBOX_DIR/my-project or just content?
# "The agent only works on the clone."
# If we cp -Rc "$PROJECT_DIR" "$SANDBOX_DIR", we get "$SANDBOX_DIR/$(basename PROJECT_DIR)"
# This is cleaner.
cp -Rc "$PROJECT_DIR" "$SANDBOX_DIR"
WORKING_DIR="$SANDBOX_DIR/$(basename "$PROJECT_DIR")"

# Copy certificates
MITM_CERT="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
if [ -f "$MITM_CERT" ]; then
    cp "$MITM_CERT" "$SANDBOX_DIR/mitmproxy-ca.pem"
    CA_PATH="$SANDBOX_DIR/mitmproxy-ca.pem"

    # Set Environment Variables
    export REQUESTS_CA_BUNDLE="$CA_PATH"
    export PIP_CERT="$CA_PATH"
    export GIT_SSL_CAINFO="$CA_PATH"
    export SSL_CERT_FILE="$CA_PATH"
    export CURL_CA_BUNDLE="$CA_PATH"
    export NODE_EXTRA_CA_CERTS="$CA_PATH"
else
    echo "Warning: mitmproxy certificate not found at $MITM_CERT. Network interception might fail SSL checks."
fi

export http_proxy="http://127.0.0.1:8080"
export https_proxy="http://127.0.0.1:8080"
export HTTP_PROXY="http://127.0.0.1:8080"
export HTTPS_PROXY="http://127.0.0.1:8080"

# Generate Profile
# Look for template in the same directory as this script
SCRIPT_DIR=$(dirname "$(realpath "$0")")
PROFILE_TEMPLATE="$SCRIPT_DIR/agent-profile.sb.template"

if [ ! -f "$PROFILE_TEMPLATE" ]; then
    echo "Error: Template $PROFILE_TEMPLATE not found."
    exit 1
fi

PROFILE_PATH=$(mktemp /tmp/gemini-profile-XXXXXX.sb)
# Escape SANDBOX_DIR for sed
ESCAPED_SANDBOX_DIR=$(echo "$SANDBOX_DIR" | sed 's/\//\\\//g')
sed "s/PLACEHOLDER_SANDBOX_DIR/$ESCAPED_SANDBOX_DIR/g" "$PROFILE_TEMPLATE" > "$PROFILE_PATH"

echo "Launching sandboxed shell in $WORKING_DIR..."

cd "$WORKING_DIR"

# Execute
# We use 'exec' to replace the current shell with sandbox-exec,
# but we are in a trap, so we might want to run it as a child.
# If we exec, the trap might not run properly if not handled?
# Actually trap EXIT runs on shell exit. exec replaces the shell process.
# If we exec, the bash script process is gone.
# So we should run it as a child command.
sandbox-exec -f "$PROFILE_PATH" /bin/bash

# When /bin/bash exits, the script continues to cleanup.
