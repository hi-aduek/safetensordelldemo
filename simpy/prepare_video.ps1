[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$VideoPath,

    [ValidateRange(0.1, 60)]
    [double]$FramesPerSecond = 2,

    [ValidateRange(0, 16384)]
    [int]$MaxDimension = 2560,

    [ValidateRange(0, 86400)]
    [double]$StartSeconds = 0,

    [ValidateRange(0, 86400)]
    [double]$DurationSeconds = 0,

    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'output')
)

$ErrorActionPreference = 'Stop'

$resolvedVideo = (Resolve-Path -LiteralPath $VideoPath).Path
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
    $localFfmpeg = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'tools\ffmpeg') -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($localFfmpeg) {
        $ffmpeg = @{ Source = $localFfmpeg.FullName }
    }
}
if (-not $ffmpeg) {
    throw 'FFmpeg was not found on PATH. Install FFmpeg and reopen PowerShell, then retry.'
}

$imagesDirectory = Join-Path $OutputDirectory 'images'
New-Item -ItemType Directory -Force -Path $imagesDirectory | Out-Null

# Prevent silently mixing frames from multiple videos/runs.
$existingImages = Get-ChildItem -LiteralPath $imagesDirectory -File -Filter '*.jpg' -ErrorAction SilentlyContinue
if ($existingImages) {
    throw "Output already contains JPG frames: $imagesDirectory. Choose another -OutputDirectory or move the existing images first."
}

$scale = if ($MaxDimension -eq 0) {
    'scale=iw:ih'
} else {
    "scale='if(gt(iw,ih),min(iw,$MaxDimension),-2)':'if(gt(ih,iw),min(ih,$MaxDimension),-2)'"
}
$fpsText = $FramesPerSecond.ToString([Globalization.CultureInfo]::InvariantCulture)
$filter = "fps=$fpsText,$scale"
$pattern = Join-Path $imagesDirectory 'frame_%06d.jpg'
$ffmpegArgs = @('-hide_banner', '-y')
if ($StartSeconds -gt 0) {
    $ffmpegArgs += @('-ss', $StartSeconds.ToString([Globalization.CultureInfo]::InvariantCulture))
}
$ffmpegArgs += @('-i', $resolvedVideo)
if ($DurationSeconds -gt 0) {
    $ffmpegArgs += @('-t', $DurationSeconds.ToString([Globalization.CultureInfo]::InvariantCulture))
}
$ffmpegArgs += @('-vf', $filter, '-q:v', '2', $pattern)

& $ffmpeg.Source @ffmpegArgs
if ($LASTEXITCODE -ne 0) {
    throw "FFmpeg failed with exit code $LASTEXITCODE."
}

$frameCount = (Get-ChildItem -LiteralPath $imagesDirectory -File -Filter '*.jpg').Count
if ($frameCount -eq 0) {
    throw 'FFmpeg completed without producing any JPG frames.'
}

Write-Host "Prepared $frameCount frames in: $imagesDirectory"
Write-Host 'Next: open COLMAP and select this images folder for a new reconstruction project.'
