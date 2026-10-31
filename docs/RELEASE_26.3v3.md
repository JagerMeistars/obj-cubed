### EN:
Experimental update to objcubed for Minecraft 26.3.

### Changes

- Added player skins on selected model faces, with Steve and Alex reference textures in Blockbench,
- Integrated skin rendering into the main resource pack, including lighting, transparent skin pixels and item display transforms,
- Added eight skin slots for item_display scenes and automatic profile datapack export,
- Replaced RGB mode buttons with dropdowns and descriptions; datapack-controlled settings remain visible but disabled,
- Added texture variables such as `#skin` for model inheritance,
- Fixed pauses at looping animation seams, incorrect animated UVs, missing faces and mirrored transforms,
- Fixed triangle UV export and atlases containing textures with the same filename,
- Reduced shader initialization warnings in logs,
- And a few other bug fixes...

Update both the plugin and resource pack. Re-export skin models and models affected by export fixes.
Player skins are experimental; dynamic skins on worn armor and skin compatibility with Iris/Chroma are not supported.
[Skin setup and limitations (RU)](https://github.com/JagerMeistars/obj-cubed/blob/26.3v3/docs/PLAYER_SKIN_TEST_RU.md).

### RU:
Экспериментальное обновление objcubed для Minecraft 26.3.

### Изменения

- Добавлены скины игроков на выбранных гранях модели и текстуры-образцы Steve и Alex в Blockbench,
- Рендер скинов встроен в основной ресурспак, включая освещение, прозрачные участки скина и преобразования отображения предмета,
- Добавлены восемь слотов скинов для сцен item_display и автоматический экспорт датапака профилей,
- Кнопки режимов RGB заменены выпадающими списками с пояснениями; управляемые датапаком настройки остаются видимыми, но недоступными,
- Добавлены переменные текстур, например `#skin`, для наследования моделей,
- Исправлены паузы на стыке циклических анимаций, неверные UV в анимации, пропадающие грани и зеркальные преобразования,
- Исправлен экспорт UV треугольников и атласов с текстурами, имеющими одинаковые имена файлов,
- Уменьшено число предупреждений об инициализации шейдеров в логах,
- И немного других баг-фиксов...

Обновите плагин и ресурспак вместе. Переэкспортируйте модели со скином и модели, затронутые исправлениями экспорта.
Поддержка скинов экспериментальная; динамический скин на надетой броне и совместимость скинов с Iris/Chroma не поддерживаются.
[Настройка скинов и ограничения](https://github.com/JagerMeistars/obj-cubed/blob/26.3v3/docs/PLAYER_SKIN_TEST_RU.md).
