# deploy.ps1
$ErrorActionPreference = "Stop"

$pemKey = if ($env:QUOIN_STAGING_PEM_PATH) {
    $env:QUOIN_STAGING_PEM_PATH
} else {
    ".secrets/quoin-staging.pem"
}
$ec2Host = "ec2-user@18.211.40.168"

Write-Host "Checking for .env.production..."
if (-not (Test-Path ".env.production")) {
    Write-Host "Missing .env.production! Please create it from .env.production.template"
    exit 1
}

Write-Host "Checking for deployment PEM..."
if (-not (Test-Path $pemKey)) {
    Write-Host "Missing deployment PEM at $pemKey"
    Write-Host "Set QUOIN_STAGING_PEM_PATH or place the PEM at .secrets/quoin-staging.pem"
    exit 1
}

Write-Host "Checking for required runtime env values..."
$envFile = Get-Content ".env.production"
$requiredEnvKeys = @(
    "DATABASE_URL",
    "REDIS_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY"
)

foreach ($key in $requiredEnvKeys) {
    if (-not ($envFile -match "^$key=.+")) {
        Write-Host "Missing required value for $key in .env.production"
        exit 1
    }
}

Write-Host "Building project locally..."
cmd.exe /c "npm run build"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!"
    exit 1
}

Write-Host "Copying static files locally for standalone..."
$staticDir = ".next/standalone/.next/static"
if (-not (Test-Path "$staticDir")) {
    New-Item -ItemType Directory -Path "$staticDir" -Force | Out-Null
}
Copy-Item -Recurse -Force ".next/static/*" "$staticDir"

$publicDir = ".next/standalone/public"
if (Test-Path "public") {
    if (-not (Test-Path "$publicDir")) {
        New-Item -ItemType Directory -Path "$publicDir" -Force | Out-Null
    }
    Copy-Item -Recurse -Force "public/*" "$publicDir"
}

Write-Host "Compressing .next/standalone for fast upload..."
tar -czf standalone.tar.gz -C .next standalone

Write-Host "Uploading standalone.tar.gz to EC2..."
scp -i $pemKey -o StrictHostKeyChecking=no standalone.tar.gz "$ec2Host`:~/"

Write-Host "Uploading .env.production to EC2..."
scp -i $pemKey -o StrictHostKeyChecking=no .env.production "$ec2Host`:~/env.production"

Write-Host "Configuring and starting remote server..."
$sshCommands = @"
set -e

echo "Setting up quoin directory..."
mkdir -p ~/quoin/.next

echo "Extracting standalone into ~/quoin/.next/..."
rm -rf ~/quoin/.next/standalone
tar -xzf ~/standalone.tar.gz -C ~/quoin/.next/

echo "Setting up env file..."
cp ~/env.production ~/quoin/.next/standalone/.env

echo "Ensuring Redis is installed and running..."
if ! command -v redis-server &> /dev/null; then
    sudo yum install -y redis6
    sudo systemctl enable redis6
    sudo systemctl start redis6
fi

echo "Ensuring PM2 is installed..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

echo "Configuring PM2..."
cat << 'EOT' > ~/quoin/ecosystem.config.js
module.exports = {
  apps: [{
    name: "quoin",
    script: "server.js",
    cwd: "/home/ec2-user/quoin/.next/standalone",
    env: {
      NODE_ENV: "production",
      HOSTNAME: "0.0.0.0",
      PORT: 3000,
      NODE_TLS_REJECT_UNAUTHORIZED: "0"
    }
  }]
}
EOT

echo "Starting app via PM2..."
cd ~/quoin
pm2 stop quoin || true
pm2 start ecosystem.config.js
pm2 save

echo "Cleaning up..."
rm -f ~/standalone.tar.gz
rm -f ~/env.production
rm -f ~/remote-setup.sh

pm2 status
echo "======================================"
echo "Deployment successfully completed!"
echo "Server is running via PM2 on port 3000"
echo "======================================"
"@
$sshCommands = $sshCommands -replace "`r`n", "`n"
Set-Content -Path "remote-setup.sh" -Value $sshCommands

Write-Host "Uploading setup script to EC2..."
scp -i $pemKey -o StrictHostKeyChecking=no remote-setup.sh "$ec2Host`:~/remote-setup.sh"

Write-Host "Running setup script on EC2..."
ssh -i $pemKey -o StrictHostKeyChecking=no $ec2Host "bash ~/remote-setup.sh"

Remove-Item -Force "remote-setup.sh"
Write-Host "Done!"
