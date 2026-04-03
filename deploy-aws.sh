#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <EC2_HOST> <SSH_KEY_PATH> [EC2_USER]"
  echo "Example: $0 ec2-13-193-95-125.ap-northeast-1.compute.amazonaws.com C:/Users/msi/Downloads/sub2api-key.pem ubuntu"
  exit 1
fi

EC2_HOST="$1"
SSH_KEY="$2"
EC2_USER="${3:-ubuntu}"
REMOTE_DIR="~/openclaw-app"

echo "==> Upload project"
scp -i "$SSH_KEY" -r ./docker-compose.yml ./fronted ./openclaw-travel-backend "$EC2_USER@$EC2_HOST:$REMOTE_DIR"

echo "==> Provision server + start containers"
ssh -i "$SSH_KEY" "$EC2_USER@$EC2_HOST" "
  set -e
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  if ! command -v docker >/dev/null 2>&1; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable\" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  sudo usermod -aG docker $USER || true
  mkdir -p $REMOTE_DIR
  cd $REMOTE_DIR

  if [ ! -f openclaw-travel-backend/.env ]; then
    cp openclaw-travel-backend/.env.example openclaw-travel-backend/.env
    echo \"Please edit $REMOTE_DIR/openclaw-travel-backend/.env and set real API keys, then run: cd $REMOTE_DIR && sudo docker compose up -d --build\"
    exit 0
  fi

  sudo docker compose up -d --build
  sudo docker compose ps
"

echo "Done. If first run created .env from example, edit it on server then run:"
echo "ssh -i \"$SSH_KEY\" $EC2_USER@$EC2_HOST \"cd $REMOTE_DIR && sudo docker compose up -d --build\""
