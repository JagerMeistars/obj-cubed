# Repository instructions

## Release descriptions

Use the Minecraft version alone as the release title, for example `26.3`.

Follow the author's wording and structure from release 26.3:

```markdown
### EN:
Update to objcubed for Minecraft <version>.

### Changes

- Short descriptions of changes visible to users,
- And a few other bug fixes...

### RU:
Обновление objcubed для Minecraft <version>.

### Изменения

- Короткие описания изменений, заметных пользователям,
- И немного других баг-фиксов...
```

English first, Russian second. Keep corresponding changes in the same order. Preserve the project name and authorship. Put test counts, hashes, implementation details and long installation instructions in repository documentation rather than release descriptions. Upload the plugin and resource pack separately as `objcubed.js` and `objcubed.zip`. When updating an existing release, retain the author's edits and append only the necessary changes in both languages.
