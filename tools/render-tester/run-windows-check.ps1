param(
    [Parameter(Mandatory=$true)][ValidateSet('matrix','raster')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$InputDirectory,
    [string]$PrismRoot = (Join-Path $env:APPDATA 'PrismLauncher'),
    [string]$JavaDirectory,
    [string]$LwjglVersion = '3.4.3',
    [string]$GlfwVersion = '3.4.1'
)
$ErrorActionPreference = 'Stop'
if (!$JavaDirectory) { $JavaDirectory = Join-Path $PrismRoot 'java/java-runtime-epsilon/bin' }
$checkRoot = (Resolve-Path -LiteralPath $InputDirectory).Path
$libraryRoot = Join-Path $PrismRoot 'libraries/org/lwjgl'
$checkJars = @()
foreach ($module in @('lwjgl','lwjgl-opengl','lwjgl-shaderc','lwjgl-spvc','lwjgl-glfw')) {
    $version = if ($module -eq 'lwjgl-glfw') { $GlfwVersion } else { $LwjglVersion }
    foreach ($suffix in @('', '-natives-windows')) {
        $jar = Join-Path $libraryRoot "$module/$version/$module-$version$suffix.jar"
        if (!(Test-Path -LiteralPath $jar) -and $suffix) {
            # Current Prism stores native artifacts as separate module names.
            $jar = Join-Path $libraryRoot "$module$suffix/$version/$module$suffix-$version.jar"
        }
        if (!(Test-Path -LiteralPath $jar)) { throw "Missing installed dependency: $jar" }
        $checkJars += $jar
    }
}
$classes = Join-Path $checkRoot 'classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
$checkClasspath = $checkJars -join ';'
& (Join-Path $JavaDirectory 'javac.exe') -cp $checkClasspath -d $classes (Join-Path $PSScriptRoot 'CurrentShaderMatrix.java') (Join-Path $PSScriptRoot 'WindowsRasterCheck.java')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$runtimeArgs = @('--enable-native-access=ALL-UNNAMED', '-Dorg.lwjgl.system.stackSize=4096', '-cp', "$checkClasspath;$classes")
if ($Mode -eq 'matrix') {
    $runtimeArgs += @('CurrentShaderMatrix', (Join-Path $checkRoot 'programs.txt'), (Join-Path $checkRoot 'results.txt'))
} else {
    $runtimeArgs += @('WindowsRasterCheck', $checkRoot)
}
& (Join-Path $JavaDirectory 'java.exe') @runtimeArgs
exit $LASTEXITCODE
