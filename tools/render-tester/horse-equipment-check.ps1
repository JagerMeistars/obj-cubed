param([Parameter(Mandatory=$true)][string]$InputDirectory)
$ErrorActionPreference='Stop'
$horseRoot=(Resolve-Path -LiteralPath $InputDirectory).Path
$horsePrism=Join-Path $env:APPDATA 'PrismLauncher'
$horseJava=Join-Path $horsePrism 'java/java-runtime-epsilon/bin'
$horseJars=foreach($module in @('lwjgl','lwjgl-opengl','lwjgl-shaderc','lwjgl-spvc','lwjgl-glfw')){
 $version=if($module -eq 'lwjgl-glfw'){'3.4.1'}else{'3.4.3'}
 foreach($suffix in @('','-natives-windows')){
  $jar=Join-Path $horsePrism "libraries/org/lwjgl/$module/$version/$module-$version$suffix.jar"
  if(!(Test-Path -LiteralPath $jar)-and $suffix){$jar=Join-Path $horsePrism "libraries/org/lwjgl/$module$suffix/$version/$module$suffix-$version.jar"}
  if(!(Test-Path -LiteralPath $jar)){throw "Missing $jar"};$jar
 }
}
$horseClasses=Join-Path $horseRoot 'classes';New-Item -ItemType Directory -Path $horseClasses -Force|Out-Null
$horseClasspath=$horseJars -join ';'
$horseSources=@('CurrentShaderMatrix.java','WindowsRasterCheck.java','HorseEquipmentCheck.java','HorseMatrixCheck.java')|ForEach-Object{Join-Path $PSScriptRoot $_}
& (Join-Path $horseJava 'javac.exe') -cp $horseClasspath -d $horseClasses @horseSources
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$horseRunner=if(Test-Path -LiteralPath (Join-Path $horseRoot 'cases.matrix.tsv')){'HorseMatrixCheck'}else{'HorseEquipmentCheck'}
& (Join-Path $horseJava 'java.exe') '--enable-native-access=ALL-UNNAMED' '-Dorg.lwjgl.system.stackSize=4096' -cp "$horseClasspath;$horseClasses" $horseRunner $horseRoot
exit $LASTEXITCODE
