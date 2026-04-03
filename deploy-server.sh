#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v sudo >/dev/null 2>&1; then
  echo "Error: sudo is required on server."
  exit 1
fi

echo "==> Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found, installing..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if [ ! -f openclaw-travel-backend/.env ]; then
  cp openclaw-travel-backend/.env.example openclaw-travel-backend/.env
  echo "==> Created openclaw-travel-backend/.env from .env.example"
  echo "Please edit API keys in openclaw-travel-backend/.env, then rerun: ./deploy-server.sh"
  exit 0
fi

echo "==> Starting services with Docker Compose"
if docker compose version >/dev/null 2>&1; then
  sudo docker compose up -d --build
else
  sudo docker-compose up -d --build
fi

echo "==> Deployment complete"
sudo docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
