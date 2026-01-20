#!/bin/sh

# Set default if not provided
API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:3001}"

echo "Generatig env.js with API_URL=$API_URL"

# Create env.js with the environment variable
cat <<EOF > ./public/env.js
window.__ENV = {
  NEXT_PUBLIC_API_URL: "$API_URL"
};
EOF

# Execute the passed command
exec "$@"
