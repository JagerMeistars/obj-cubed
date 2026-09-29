param(
    [string]$OutputDirectory = 'audit/native-equipment',
    [string]$PrismRoot = (Join-Path $env:APPDATA 'PrismLauncher'),
    [string]$JavaDirectory
)
$ErrorActionPreference = 'Stop'
$probeRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
if (![IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory = Join-Path $probeRoot $OutputDirectory }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (!$JavaDirectory) { $JavaDirectory = Join-Path $PrismRoot 'java/java-runtime-epsilon/bin' }
$probeMetadata = Join-Path $PrismRoot 'meta/net.minecraft/26.3.json'
$probeLibraries = Join-Path $PrismRoot 'libraries'
$probeJar = Join-Path $probeLibraries 'com/mojang/minecraft/26.3/minecraft-26.3-client.jar'
foreach ($required in @($probeMetadata, $probeJar, (Join-Path $JavaDirectory 'javac.exe'), (Join-Path $JavaDirectory 'java.exe'))) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing installed dependency: $required" }
}
$probeMeta = Get-Content -LiteralPath $probeMetadata -Raw | ConvertFrom-Json
$probeJars = @($probeJar)
foreach ($library in $probeMeta.libraries) {
    if ($library.downloads.artifact.url) {
        $file = Join-Path $probeLibraries ([uri]$library.downloads.artifact.url).AbsolutePath.TrimStart('/')
        if (Test-Path -LiteralPath $file -PathType Leaf) { $probeJars += $file }
    }
}
$probeClasspath = $probeJars -join ';'
$probeClasses = Join-Path $OutputDirectory 'classes'
New-Item -ItemType Directory -Path $probeClasses -Force | Out-Null
& (Join-Path $JavaDirectory 'javac.exe') -cp $probeClasspath -d $probeClasses (Join-Path $PSScriptRoot 'NativeEquipmentProbe.java')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $JavaDirectory 'java.exe') '-Djava.awt.headless=true' -Xmx768m -cp "$probeClasspath;$probeClasses" NativeEquipmentProbe (Join-Path $OutputDirectory 'native-models.json')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$probeManifest = [ordered]@{
    minecraft = '26.3'
    clientJar = $probeJar
    clientJarSha256 = (Get-FileHash -LiteralPath $probeJar -Algorithm SHA256).Hash.ToLowerInvariant()
    probeSourceSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'NativeEquipmentProbe.java') -Algorithm SHA256).Hash.ToLowerInvariant()
    nativeModelsSha256 = (Get-FileHash -LiteralPath (Join-Path $OutputDirectory 'native-models.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    method = 'CPU only: actual 26.3 LayerDefinitions and ModelPart setupAnim. No game world, GPU context, UI, or user-profile writes.'
}
$probeManifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'native-probe-manifest.json') -Encoding utf8
Write-Output "Native equipment probe saved to $OutputDirectory"
