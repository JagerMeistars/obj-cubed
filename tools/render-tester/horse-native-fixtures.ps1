param([string]$OutputFile='audit/2026-09-29/animal-equipment/native-poses.json')
$ErrorActionPreference='Stop'
$horsePrism=Join-Path $env:APPDATA 'PrismLauncher'
$horseMeta=Get-Content -LiteralPath "$horsePrism/meta/net.minecraft/26.3.json" -Raw|ConvertFrom-Json
$horseLibRoot="$horsePrism/libraries"
$horseCp=@("$horseLibRoot/com/mojang/minecraft/26.3/minecraft-26.3-client.jar")
foreach($lib in $horseMeta.libraries){if($lib.downloads.artifact.url){$file=Join-Path $horseLibRoot ([uri]$lib.downloads.artifact.url).AbsolutePath.TrimStart('/');if(Test-Path -LiteralPath $file){$horseCp+=$file}}}
$horseOut=[IO.Path]::GetFullPath($OutputFile);$horseClasses=Join-Path ([IO.Path]::GetDirectoryName($horseOut)) 'native-classes';New-Item -ItemType Directory -Path $horseClasses -Force|Out-Null
$horseClasspath=$horseCp -join ';'
& "$horsePrism/java/java-runtime-epsilon/bin/javac.exe" -cp $horseClasspath -d $horseClasses (Join-Path $PSScriptRoot 'HorseNativeFixtures.java')
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
& "$horsePrism/java/java-runtime-epsilon/bin/java.exe" '-Djava.awt.headless=true' -Xmx512m -cp "$horseClasspath;$horseClasses" HorseNativeFixtures $horseOut
exit $LASTEXITCODE
