param([Parameter(Mandatory=$true)][string]$InputDirectory)
$ErrorActionPreference = 'Stop'
$checkRoot = (Resolve-Path -LiteralPath $InputDirectory).Path
$checkPrism = Join-Path $env:APPDATA 'PrismLauncher'
$checkJava = Join-Path $checkPrism 'java/java-runtime-epsilon/bin'
$checkJars = foreach ($module in @('lwjgl','lwjgl-opengl','lwjgl-shaderc','lwjgl-spvc','lwjgl-glfw')) {
    $version = if ($module -eq 'lwjgl-glfw') { '3.4.1' } else { '3.4.3' }
    foreach ($suffix in @('', '-natives-windows')) {
        $jar = Join-Path $checkPrism "libraries/org/lwjgl/$module/$version/$module-$version$suffix.jar"
        if (!(Test-Path -LiteralPath $jar) -and $suffix) { $jar = Join-Path $checkPrism "libraries/org/lwjgl/$module$suffix/$version/$module$suffix-$version.jar" }
        if (!(Test-Path -LiteralPath $jar)) { throw "Missing $jar" }; $jar
    }
}
$checkClasses = Join-Path $checkRoot 'classes'
New-Item -ItemType Directory -Path $checkClasses -Force | Out-Null
$checkClasspath = $checkJars -join ';'
$checkSources = @('CurrentShaderMatrix.java','WindowsRasterCheck.java','ColorBehaviorCheck.java','TextureAnimationCheck.java') | ForEach-Object { Join-Path $PSScriptRoot $_ }
& (Join-Path $checkJava 'javac.exe') -cp $checkClasspath -d $checkClasses @checkSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $checkJava 'java.exe') '--enable-native-access=ALL-UNNAMED' '-Dorg.lwjgl.system.stackSize=4096' -cp "$checkClasspath;$checkClasses" TextureAnimationCheck $checkRoot
exit $LASTEXITCODE
