param(
    [Parameter(Mandatory=$true)][string]$InputDirectory,
    [string]$PrismRoot = (Join-Path $env:APPDATA 'PrismLauncher'),
    [string]$JavaDirectory
)
$ErrorActionPreference = 'Stop'
if (!$JavaDirectory) { $JavaDirectory = Join-Path $PrismRoot 'java/java-runtime-epsilon/bin' }
$checkRoot = (Resolve-Path -LiteralPath $InputDirectory).Path
$libraryRoot = Join-Path $PrismRoot 'libraries/org/lwjgl'
$checkJars = @()
foreach ($module in @('lwjgl','lwjgl-opengl','lwjgl-shaderc','lwjgl-spvc','lwjgl-glfw')) {
    $version = if ($module -eq 'lwjgl-glfw') { '3.4.1' } else { '3.4.3' }
    foreach ($suffix in @('', '-natives-windows')) {
        $jar = Join-Path $libraryRoot "$module/$version/$module-$version$suffix.jar"
        if (!(Test-Path -LiteralPath $jar) -and $suffix) {
            $jar = Join-Path $libraryRoot "$module$suffix/$version/$module$suffix-$version.jar"
        }
        if (!(Test-Path -LiteralPath $jar)) { throw "Missing installed dependency: $jar" }
        $checkJars += $jar
    }
}
$classes = Join-Path $checkRoot 'classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
$checkClasspath = $checkJars -join ';'
& (Join-Path $JavaDirectory 'javac.exe') -cp $checkClasspath -d $classes (Join-Path $PSScriptRoot 'CurrentShaderMatrix.java') (Join-Path $PSScriptRoot 'WindowsRasterCheck.java') (Join-Path $PSScriptRoot 'ColorBehaviorCheck.java')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $JavaDirectory 'java.exe') '--enable-native-access=ALL-UNNAMED' '-Dorg.lwjgl.system.stackSize=4096' -cp "$checkClasspath;$classes" ColorBehaviorCheck $checkRoot
exit $LASTEXITCODE
