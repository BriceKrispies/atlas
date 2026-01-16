# Quick log inspection helper for Atlas Platform containers (PowerShell version)
#
# Usage:
#   .\scripts\logs.ps1                     - Follow all itest container logs
#   .\scripts\logs.ps1 ingress             - Follow ingress logs only
#   .\scripts\logs.ps1 workers             - Follow workers logs only
#   .\scripts\logs.ps1 postgres            - Follow postgres logs only
#   .\scripts\logs.ps1 control-plane       - Follow control-plane logs only
#   .\scripts\logs.ps1 ingress,workers     - Follow multiple services
#   .\scripts\logs.ps1 -Tail 100 ingress   - Show last 100 lines then follow

param(
    [int]$Tail = 50,
    [switch]$NoFollow,
    [switch]$Help,
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Services
)

$ContainerRuntime = if ($env:CONTAINER_RUNTIME) { $env:CONTAINER_RUNTIME } else { "docker" }

function Show-Help {
    Write-Host "Atlas Platform Log Inspector" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage: .\logs.ps1 [OPTIONS] [SERVICE...]"
    Write-Host ""
    Write-Host "Services:" -ForegroundColor Yellow
    Write-Host "  ingress         - Ingress API gateway logs"
    Write-Host "  workers         - Background workers logs"
    Write-Host "  postgres        - Database logs"
    Write-Host "  control-plane   - Control plane API logs"
    Write-Host "  dozzle          - Log viewer UI logs"
    Write-Host "  (no service)    - All itest containers"
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Yellow
    Write-Host "  -Tail N         - Show last N lines before following (default: 50)"
    Write-Host "  -NoFollow       - Don't follow logs, just dump and exit"
    Write-Host "  -Help           - Show this help"
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Green
    Write-Host "  .\logs.ps1                           # All logs"
    Write-Host "  .\logs.ps1 ingress                   # Just ingress"
    Write-Host "  .\logs.ps1 ingress workers           # Ingress + workers"
    Write-Host "  .\logs.ps1 -Tail 200 postgres        # Last 200 postgres lines"
    Write-Host "  .\logs.ps1 -NoFollow ingress         # Dump ingress logs and exit"
    Write-Host ""
    Write-Host "Tip: Use Dozzle web UI for richer log viewing:" -ForegroundColor Cyan
    Write-Host "     http://localhost:8080"
}

function Map-ToContainer {
    param([string]$Service)

    switch ($Service) {
        "ingress" { return "atlas-itest-ingress" }
        "workers" { return "atlas-itest-workers" }
        { $_ -in "postgres", "db" } { return "atlas-itest-db" }
        { $_ -in "control-plane", "cp" } { return "atlas-itest-control-plane" }
        "dozzle" { return "atlas-itest-dozzle" }
        default { return $Service }
    }
}

if ($Help) {
    Show-Help
    exit 0
}

# Build log command flags
$LogCmd = @($ContainerRuntime, "logs")

if (-not $NoFollow) {
    $LogCmd += "-f"
}

$LogCmd += @("--tail", $Tail)

# Determine what containers to follow
if ($Services.Count -eq 0) {
    # No services specified - show all atlas-itest containers
    Write-Host "→ Following all Atlas Platform integration test containers..." -ForegroundColor Blue

    $Matching = & $ContainerRuntime ps --format "{{.Names}}" --filter "name=atlas-itest-" | Where-Object { $_ }

    if (-not $Matching) {
        Write-Host "No running containers found matching: atlas-itest-*" -ForegroundColor Red
        exit 1
    }

    Write-Host "✓ Found containers:" -ForegroundColor Green
    $Matching | ForEach-Object { Write-Host "  - $_" }
    Write-Host ""

    # Try to use docker-compose for better output
    Push-Location "$PSScriptRoot\..\infra\compose"
    if (Test-Path "docker-compose.itest.yml") {
        $ComposeCmd = @($ContainerRuntime, "compose", "-f", "docker-compose.itest.yml", "logs")
        if (-not $NoFollow) { $ComposeCmd += "-f" }
        $ComposeCmd += @("--tail", $Tail)

        & $ComposeCmd
        Pop-Location
        exit 0
    }
    Pop-Location

    # Fallback: individual container logs
    $Jobs = @()
    foreach ($Container in $Matching) {
        $Jobs += Start-Job -ScriptBlock {
            param($Runtime, $Container, $LogCmd)
            & $Runtime logs -f --tail $LogCmd $Container
        } -ArgumentList $ContainerRuntime, $Container, $Tail
    }

    # Wait for all jobs
    $Jobs | Wait-Job | Receive-Job
} else {
    # Map service names to container names
    $Containers = $Services | ForEach-Object { Map-ToContainer $_ }

    Write-Host "→ Following: $($Containers -join ', ')" -ForegroundColor Blue

    # Check each container exists
    $ValidContainers = @()
    foreach ($Container in $Containers) {
        $Exists = & $ContainerRuntime ps --format "{{.Names}}" | Select-String -Pattern "^$Container$" -Quiet
        if ($Exists) {
            $ValidContainers += $Container
        } else {
            Write-Host "Warning: Container '$Container' not found or not running" -ForegroundColor Yellow
        }
    }

    if ($ValidContainers.Count -eq 0) {
        Write-Host "No valid containers to follow" -ForegroundColor Red
        exit 1
    }

    if ($ValidContainers.Count -eq 1) {
        # Single container - follow directly
        & $LogCmd $ValidContainers[0]
    } else {
        # Multiple containers - use jobs to follow in parallel
        $Jobs = @()
        foreach ($Container in $ValidContainers) {
            $Jobs += Start-Job -ScriptBlock {
                param($Runtime, $Container, $Follow, $TailCount)
                $Cmd = @($Runtime, "logs", "--tail", $TailCount)
                if ($Follow) { $Cmd += "-f" }
                $Cmd += $Container
                & $Cmd[0] $Cmd[1..($Cmd.Length-1)]
            } -ArgumentList $ContainerRuntime, $Container, (-not $NoFollow), $Tail
        }

        # Display logs from all jobs in real-time
        try {
            while ($Jobs | Where-Object { $_.State -eq 'Running' }) {
                $Jobs | Receive-Job
                Start-Sleep -Milliseconds 100
            }
            $Jobs | Receive-Job
        } finally {
            $Jobs | Remove-Job -Force
        }
    }
}
