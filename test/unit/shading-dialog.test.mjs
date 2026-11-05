import {expect, it} from 'vitest';
import {createRequire} from 'node:module';
const {loadColorPlugin} = createRequire(import.meta.url)('../helpers/color-plugin.cjs');

it('exports the shading selected under Advanced and remembers it when the dialog reopens', async () => {
  const plugin = loadColorPlugin();
  const state = plugin.openDialog();
  expect(state.shadingMode).toBe('flat');
  const template = plugin.dialogOptions.component.template;
  const advanced = template.slice(template.indexOf("t('section_advanced')"), template.indexOf('<!-- ======== FOOTER'));
  expect(advanced).toMatch(/<select[^>]*v-model="shadingMode"/);
  const options = advanced.match(/<select v-model="shadingMode"[^>]*>([\s\S]*?)<\/select>/)[1];
  expect([...options.matchAll(/<option value="([^"]+)">([^<]+)</g)].map(m=>[m[1],m[2]])).toEqual([['flat','Flat'],['smooth','Smooth'],['ambient','Ambient']]);
  let exported;
  plugin.api.setExportSink(async cfg => { exported = cfg; });
  for (const mode of ['smooth','ambient','flat']) {
    state.shadingMode = mode;
    await state.doExport();
    expect(exported.shadingMode).toBe(mode);
    expect(plugin.openDialog().shadingMode).toBe(mode);
  }
});
