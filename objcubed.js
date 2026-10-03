/*
MIT License

Copyright (c) 2022 Godlander

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
(function () {
    'use strict';

    const PLUGIN_ID = 'objcubed';

    // =========================================================
    // Constants (HOISTED — must be declared before Plugin Registration
    // so that the Vue dialog component, which captures them via closure,
    // sees them initialized regardless of any pre-render passes Blockbench
    // performs on component.data() during plugin install.)
    // =========================================================

    // Fields that are user-configurable and should persist between sessions.
    // Anything not in this list (texOptions, hasAnims, status, etc.) stays
    // ephemeral.
    // One-shot Display-editor pull handoff: uuid of the project whose export
    // dialog should read back Project.display_settings on next open.
    let pullDisplayForProject = null;
    const PERSISTABLE_FIELDS = [
        // Texture
        'selectedTex', 'useAtlas', 'atlasTexChecked',
        'texAnimEnabled', 'texFrametime', 'texFade',
        // Transform
        'scale', 'offsetX', 'offsetY', 'offsetZ',
        // Animation
        'animationEnabled', 'animationIndex', 'animFps', 'animStart', 'animEnd',
        'autoplay',
        // Datapack
        'generateDatapack', 'exportCameras', 'datapackNamespace', 'datapackAnimId',
        'datapackTargetType', 'datapackEquipSlot', 'datapackOutputDir',
        // Output paths
        'resourcePackDir', 'baseItem', 'cmdName', 'outputMode', 'filesOutputDir', 'modelOutputDir', 'textureOutputDir', 'textureResource', 'customContexts', 'selectedContexts',
        // Equipment (armor) export — Approach C
        'exportAsEquipment', 'equipmentTarget', 'equipmentSlot', 'selectedPieces',
        // Display — right hand & shared
        'useSeparateLefthand',
        'dThirdRX','dThirdRY','dThirdRZ','dThirdTX','dThirdTY','dThirdTZ','dThirdSX','dThirdSY','dThirdSZ',
        // Display — left hand (independent third-person, when useSeparateLefthand=true)
        'dLeftRX','dLeftRY','dLeftRZ','dLeftTX','dLeftTY','dLeftTZ','dLeftSX','dLeftSY','dLeftSZ',
        // Display — head/ground/fixed
        'dHeadRX','dHeadRY','dHeadRZ','dHeadTX','dHeadTY','dHeadTZ','dHeadSX','dHeadSY','dHeadSZ',
        'dGroundRX','dGroundRY','dGroundRZ','dGroundTX','dGroundTY','dGroundTZ','dGroundSX','dGroundSY','dGroundSZ',
        'dFixedRX','dFixedRY','dFixedRZ','dFixedTX','dFixedTY','dFixedTZ','dFixedSX','dFixedSY','dFixedSZ',
        // Display — GUI, first-person hands, on_shelf
        'dGuiRX','dGuiRY','dGuiRZ','dGuiTX','dGuiTY','dGuiTZ','dGuiSX','dGuiSY','dGuiSZ',
        'dGuiPX','dGuiPY','dGuiPZ',
        'dFprRX','dFprRY','dFprRZ','dFprTX','dFprTY','dFprTZ','dFprSX','dFprSY','dFprSZ',
        'dFplRX','dFplRY','dFplRZ','dFplTX','dFplTY','dFplTZ','dFplSX','dFplSY','dFplSZ',
        'dShelfRX','dShelfRY','dShelfRZ','dShelfTX','dShelfTY','dShelfTZ','dShelfSX','dShelfSY','dShelfSZ',
        // Color & Tinting
        'cbR', 'cbG', 'cbB',
        // Advanced
        'easing', 'interpolation', 'autorotate',
        'flipuv', 'noshadow', 'nopow', 'filterArmature',
    ];

    const HORSE_EQUIPMENT = {
        horse_body: { layer: 'horse_body', slot: 'body', item: 'leather_horse_armor', kind: 0 },
        horse_saddle: { layer: 'horse_saddle', slot: 'saddle', item: 'saddle', kind: 1 },
    };
    const horseEquipmentOf = cfg => cfg.exportAsEquipment &&
        Object.prototype.hasOwnProperty.call(HORSE_EQUIPMENT, cfg.equipmentTarget)
        ? HORSE_EQUIPMENT[cfg.equipmentTarget] : null;
    function horseEquippable(horse, asset) {
        const shears = horse.slot === 'saddle' ? ',can_be_sheared:true,shearing_sound:"minecraft:item.saddle.unequip"' : '';
        return `{slot:"${horse.slot}",asset_id:"minecraft:${asset}",allowed_entities:["minecraft:horse"],equip_sound:"minecraft:intentionally_empty",damage_on_hurt:false,equip_on_interact:true${shears}}`;
    }


    // Native 26.3 equipment catalog. Standalone plugin: no external data fetch.
    const ANIMAL_EQUIPMENT = {"horse_body":{"layer":"horse_body","slot":"body","item":"leather_horse_armor","entity":"horse","defaultPart":"body","labels":["Horse armor","Конская броня"],"component":{"slot":"body","equip_sound":"minecraft:entity.horse.armor","asset_id":"minecraft:copper","allowed_entities":"#minecraft:can_wear_horse_armor","damage_on_hurt":false,"can_be_sheared":true,"shearing_sound":"minecraft:item.horse_armor.unequip"}},"horse_saddle":{"layer":"horse_saddle","slot":"saddle","item":"saddle","entity":"horse","defaultPart":"body","labels":["Horse saddle","Седло лошади"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:horse"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"donkey_saddle":{"layer":"donkey_saddle","slot":"saddle","item":"saddle","entity":"donkey","defaultPart":"body","labels":["Donkey saddle","Седло осла"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:donkey"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"mule_saddle":{"layer":"mule_saddle","slot":"saddle","item":"saddle","entity":"mule","defaultPart":"body","labels":["Mule saddle","Седло мула"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:mule"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"zombie_horse_saddle":{"layer":"zombie_horse_saddle","slot":"saddle","item":"saddle","entity":"zombie_horse","defaultPart":"body","labels":["Zombie horse saddle","Седло лошади-зомби"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:zombie_horse"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"skeleton_horse_saddle":{"layer":"skeleton_horse_saddle","slot":"saddle","item":"saddle","entity":"skeleton_horse","defaultPart":"body","labels":["Skeleton horse saddle","Седло лошади-скелета"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:skeleton_horse"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"wolf_body":{"layer":"wolf_body","slot":"body","item":"wolf_armor","entity":"wolf","defaultPart":"body","labels":["Wolf armor","Волчья броня"],"component":{"slot":"body","equip_sound":"minecraft:item.armor.equip_wolf","asset_id":"minecraft:armadillo_scute","allowed_entities":"minecraft:wolf","can_be_sheared":true,"shearing_sound":"minecraft:item.armor.unequip_wolf"}},"llama_body":{"layer":"llama_body","slot":"body","item":"white_carpet","entity":"llama","defaultPart":"body","labels":["Llama carpet","Попона ламы"],"component":{"slot":"body","equip_sound":"minecraft:entity.llama.swag","asset_id":"minecraft:white_carpet","allowed_entities":["minecraft:llama","minecraft:trader_llama"],"can_be_sheared":true,"shearing_sound":"minecraft:item.llama_carpet.unequip"}},"happy_ghast_body":{"layer":"happy_ghast_body","slot":"body","item":"white_harness","entity":"happy_ghast","defaultPart":"harness","labels":["Happy ghast harness","Упряжь счастливого гаста"],"component":{"slot":"body","equip_sound":"minecraft:entity.happy_ghast.equip","asset_id":"minecraft:white_harness","allowed_entities":"#minecraft:can_equip_harness","equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:entity.happy_ghast.unequip"}},"wings":{"layer":"wings","slot":"chest","item":"elytra","entity":"player","defaultPart":"wings","labels":["Elytra","Элитры"],"component":{"slot":"chest","equip_sound":"minecraft:item.armor.equip_elytra","asset_id":"minecraft:elytra","damage_on_hurt":false}},"camel_saddle":{"layer":"camel_saddle","slot":"saddle","item":"saddle","entity":"camel","defaultPart":"body","labels":["Camel saddle","Седло верблюда"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:camel"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"camel_husk_saddle":{"layer":"camel_husk_saddle","slot":"saddle","item":"saddle","entity":"camel_husk","defaultPart":"body","labels":["Camel husk saddle","Седло верблюда-кадавра"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:camel_husk"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"pig_saddle":{"layer":"pig_saddle","slot":"saddle","item":"saddle","entity":"pig","defaultPart":"body","labels":["Pig saddle","Седло свиньи"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:pig"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"strider_saddle":{"layer":"strider_saddle","slot":"saddle","item":"saddle","entity":"strider","defaultPart":"body","labels":["Strider saddle","Седло лавомерки"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:strider"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}},"nautilus_body":{"layer":"nautilus_body","slot":"body","item":"iron_nautilus_armor","entity":"nautilus","defaultPart":"shell","labels":["Nautilus armor","Броня наутилуса"],"component":{"slot":"body","equip_sound":"minecraft:item.armor.equip_nautilus","asset_id":"minecraft:iron","allowed_entities":"#minecraft:can_wear_nautilus_armor","damage_on_hurt":false,"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.armor.unequip_nautilus"}},"nautilus_saddle":{"layer":"nautilus_saddle","slot":"saddle","item":"saddle","entity":"nautilus","defaultPart":"shell","labels":["Nautilus saddle","Седло наутилуса"],"component":{"slot":"saddle","equip_sound":"minecraft:entity.horse.saddle","asset_id":"minecraft:saddle","allowed_entities":["minecraft:nautilus","minecraft:zombie_nautilus"],"equip_on_interact":true,"can_be_sheared":true,"shearing_sound":"minecraft:item.saddle.unequip"}}};
    // BEGIN GENERATED EQUIPMENT CARRIERS
    const EQUIPMENT_CARRIERS = {"horse_body":{"textureSize":[64,64],"modelLayer":"HORSE_ARMOR","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.34375,0.5,0.5,0.84375],"q0":[0.315625,-0.503125,0.315625],"q1":[-0.315625,-0.503125,0.315625],"q3":[0.315625,-0.503125,-1.065625],"normal":[0,-1,0]},{"uv":[0.5,0.5,0.65625,0.84375],"q0":[0.315625,0.128125,0.315625],"q1":[-0.315625,0.128125,0.315625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,1,0]},{"uv":[0,0.84375,0.34375,1],"q0":[-0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,-1.065625],"normal":[-1,0,0]},{"uv":[0.34375,0.84375,0.5,1],"q0":[0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,0,-1]},{"uv":[0.5,0.84375,0.84375,1],"q0":[0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,0.315625],"normal":[1,0,0]},{"uv":[0.84375,0.84375,1,1],"q0":[-0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,0.315625],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head_parts/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.109375,0.203125,0.203125,0.3125],"q0":[0.19375,-0.69375,0.31875],"q1":[-0.19375,-0.69375,0.31875],"q3":[0.19375,-0.69375,-0.13125],"normal":[0,-1,0]},{"uv":[0.203125,0.203125,0.296875,0.3125],"q0":[0.19375,-0.36875,0.31875],"q1":[-0.19375,-0.36875,0.31875],"q3":[0.19375,-0.36875,-0.13125],"normal":[0,1,0]},{"uv":[0,0.3125,0.109375,0.390625],"q0":[-0.19375,-0.69375,-0.13125],"q1":[-0.19375,-0.69375,0.31875],"q3":[-0.19375,-0.36875,-0.13125],"normal":[-1,0,0]},{"uv":[0.109375,0.3125,0.203125,0.390625],"q0":[0.19375,-0.69375,-0.13125],"q1":[-0.19375,-0.69375,-0.13125],"q3":[0.19375,-0.36875,-0.13125],"normal":[0,0,-1]},{"uv":[0.203125,0.3125,0.3125,0.390625],"q0":[0.19375,-0.69375,0.31875],"q1":[0.19375,-0.69375,-0.13125],"q3":[0.19375,-0.36875,0.31875],"normal":[1,0,0]},{"uv":[0.3125,0.3125,0.40625,0.390625],"q0":[-0.19375,-0.69375,0.31875],"q1":[0.19375,-0.69375,0.31875],"q3":[-0.19375,-0.36875,0.31875],"normal":[0,0,1]}]},"legs":{"label":"Legs (repeated on all four)","path":"root/right_front_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.8125,0.328125,0.875,0.390625],"q0":[0.19375,-0.069375,0.13749999],"q1":[-0.06875,-0.069375,0.13749999],"q3":[0.19375,-0.069375,-0.125],"normal":[0,-1,0]},{"uv":[0.875,0.328125,0.9375,0.390625],"q0":[0.19375,0.630625,0.13749999],"q1":[-0.06875,0.630625,0.13749999],"q3":[0.19375,0.630625,-0.125],"normal":[0,1,0]},{"uv":[0.75,0.390625,0.8125,0.5625],"q0":[-0.06875,-0.069375,-0.125],"q1":[-0.06875,-0.069375,0.13749999],"q3":[-0.06875,0.630625,-0.125],"normal":[-1,0,0]},{"uv":[0.8125,0.390625,0.875,0.5625],"q0":[0.19375,-0.069375,-0.125],"q1":[-0.06875,-0.069375,-0.125],"q3":[0.19375,0.630625,-0.125],"normal":[0,0,-1]},{"uv":[0.875,0.390625,0.9375,0.5625],"q0":[0.19375,-0.069375,0.13749999],"q1":[0.19375,-0.069375,-0.125],"q3":[0.19375,0.630625,0.13749999],"normal":[1,0,0]},{"uv":[0.9375,0.390625,1,0.5625],"q0":[-0.06875,-0.069375,0.13749999],"q1":[0.19375,-0.069375,0.13749999],"q3":[-0.06875,0.630625,0.13749999],"normal":[0,0,1]}],"repeats":4}}},"horse_saddle":{"textureSize":[64,64],"modelLayer":"HORSE_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.34375,0.5,0.5,0.84375],"q0":[0.315625,-0.503125,0.315625],"q1":[-0.315625,-0.503125,0.315625],"q3":[0.315625,-0.503125,-1.065625],"normal":[0,-1,0]},{"uv":[0.5,0.5,0.65625,0.84375],"q0":[0.315625,0.128125,0.315625],"q1":[-0.315625,0.128125,0.315625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,1,0]},{"uv":[0,0.84375,0.34375,1],"q0":[-0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,-1.065625],"normal":[-1,0,0]},{"uv":[0.34375,0.84375,0.5,1],"q0":[0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,0,-1]},{"uv":[0.5,0.84375,0.84375,1],"q0":[0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,0.315625],"normal":[1,0,0]},{"uv":[0.84375,0.84375,1,1],"q0":[-0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,0.315625],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head_parts/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.109375,0.203125,0.203125,0.3125],"q0":[0.1875,-0.6875,0.3125],"q1":[-0.1875,-0.6875,0.3125],"q3":[0.1875,-0.6875,-0.125],"normal":[0,-1,0]},{"uv":[0.203125,0.203125,0.296875,0.3125],"q0":[0.1875,-0.375,0.3125],"q1":[-0.1875,-0.375,0.3125],"q3":[0.1875,-0.375,-0.125],"normal":[0,1,0]},{"uv":[0,0.3125,0.109375,0.390625],"q0":[-0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,-0.125],"normal":[-1,0,0]},{"uv":[0.109375,0.3125,0.203125,0.390625],"q0":[0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,-0.125],"normal":[0,0,-1]},{"uv":[0.203125,0.3125,0.3125,0.390625],"q0":[0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,0.3125],"normal":[1,0,0]},{"uv":[0.3125,0.3125,0.40625,0.390625],"q0":[-0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,0.3125],"normal":[0,0,1]}]}}},"donkey_saddle":{"textureSize":[64,64],"modelLayer":"DONKEY_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.34375,0.5,0.5,0.84375],"q0":[0.315625,-0.503125,0.315625],"q1":[-0.315625,-0.503125,0.315625],"q3":[0.315625,-0.503125,-1.065625],"normal":[0,-1,0]},{"uv":[0.5,0.5,0.65625,0.84375],"q0":[0.315625,0.128125,0.315625],"q1":[-0.315625,0.128125,0.315625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,1,0]},{"uv":[0,0.84375,0.34375,1],"q0":[-0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,-1.065625],"normal":[-1,0,0]},{"uv":[0.34375,0.84375,0.5,1],"q0":[0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,0,-1]},{"uv":[0.5,0.84375,0.84375,1],"q0":[0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,0.315625],"normal":[1,0,0]},{"uv":[0.84375,0.84375,1,1],"q0":[-0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,0.315625],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head_parts/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.109375,0.203125,0.203125,0.3125],"q0":[0.1875,-0.6875,0.3125],"q1":[-0.1875,-0.6875,0.3125],"q3":[0.1875,-0.6875,-0.125],"normal":[0,-1,0]},{"uv":[0.203125,0.203125,0.296875,0.3125],"q0":[0.1875,-0.375,0.3125],"q1":[-0.1875,-0.375,0.3125],"q3":[0.1875,-0.375,-0.125],"normal":[0,1,0]},{"uv":[0,0.3125,0.109375,0.390625],"q0":[-0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,-0.125],"normal":[-1,0,0]},{"uv":[0.109375,0.3125,0.203125,0.390625],"q0":[0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,-0.125],"normal":[0,0,-1]},{"uv":[0.203125,0.3125,0.3125,0.390625],"q0":[0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,0.3125],"normal":[1,0,0]},{"uv":[0.3125,0.3125,0.40625,0.390625],"q0":[-0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,0.3125],"normal":[0,0,1]}]}}},"mule_saddle":{"textureSize":[64,64],"modelLayer":"MULE_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.34375,0.5,0.5,0.84375],"q0":[0.315625,-0.503125,0.315625],"q1":[-0.315625,-0.503125,0.315625],"q3":[0.315625,-0.503125,-1.065625],"normal":[0,-1,0]},{"uv":[0.5,0.5,0.65625,0.84375],"q0":[0.315625,0.128125,0.315625],"q1":[-0.315625,0.128125,0.315625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,1,0]},{"uv":[0,0.84375,0.34375,1],"q0":[-0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,-1.065625],"normal":[-1,0,0]},{"uv":[0.34375,0.84375,0.5,1],"q0":[0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,0,-1]},{"uv":[0.5,0.84375,0.84375,1],"q0":[0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,0.315625],"normal":[1,0,0]},{"uv":[0.84375,0.84375,1,1],"q0":[-0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,0.315625],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head_parts/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.109375,0.203125,0.203125,0.3125],"q0":[0.1875,-0.6875,0.3125],"q1":[-0.1875,-0.6875,0.3125],"q3":[0.1875,-0.6875,-0.125],"normal":[0,-1,0]},{"uv":[0.203125,0.203125,0.296875,0.3125],"q0":[0.1875,-0.375,0.3125],"q1":[-0.1875,-0.375,0.3125],"q3":[0.1875,-0.375,-0.125],"normal":[0,1,0]},{"uv":[0,0.3125,0.109375,0.390625],"q0":[-0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,-0.125],"normal":[-1,0,0]},{"uv":[0.109375,0.3125,0.203125,0.390625],"q0":[0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,-0.125],"normal":[0,0,-1]},{"uv":[0.203125,0.3125,0.3125,0.390625],"q0":[0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,0.3125],"normal":[1,0,0]},{"uv":[0.3125,0.3125,0.40625,0.390625],"q0":[-0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,0.3125],"normal":[0,0,1]}]}}},"zombie_horse_saddle":{"textureSize":[64,64],"modelLayer":"ZOMBIE_HORSE_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.34375,0.5,0.5,0.84375],"q0":[0.315625,-0.503125,0.315625],"q1":[-0.315625,-0.503125,0.315625],"q3":[0.315625,-0.503125,-1.065625],"normal":[0,-1,0]},{"uv":[0.5,0.5,0.65625,0.84375],"q0":[0.315625,0.128125,0.315625],"q1":[-0.315625,0.128125,0.315625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,1,0]},{"uv":[0,0.84375,0.34375,1],"q0":[-0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,-1.065625],"normal":[-1,0,0]},{"uv":[0.34375,0.84375,0.5,1],"q0":[0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,0,-1]},{"uv":[0.5,0.84375,0.84375,1],"q0":[0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,0.315625],"normal":[1,0,0]},{"uv":[0.84375,0.84375,1,1],"q0":[-0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,0.315625],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head_parts/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.109375,0.203125,0.203125,0.3125],"q0":[0.1875,-0.6875,0.3125],"q1":[-0.1875,-0.6875,0.3125],"q3":[0.1875,-0.6875,-0.125],"normal":[0,-1,0]},{"uv":[0.203125,0.203125,0.296875,0.3125],"q0":[0.1875,-0.375,0.3125],"q1":[-0.1875,-0.375,0.3125],"q3":[0.1875,-0.375,-0.125],"normal":[0,1,0]},{"uv":[0,0.3125,0.109375,0.390625],"q0":[-0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,-0.125],"normal":[-1,0,0]},{"uv":[0.109375,0.3125,0.203125,0.390625],"q0":[0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,-0.125],"normal":[0,0,-1]},{"uv":[0.203125,0.3125,0.3125,0.390625],"q0":[0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,0.3125],"normal":[1,0,0]},{"uv":[0.3125,0.3125,0.40625,0.390625],"q0":[-0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,0.3125],"normal":[0,0,1]}]}}},"skeleton_horse_saddle":{"textureSize":[64,64],"modelLayer":"SKELETON_HORSE_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.34375,0.5,0.5,0.84375],"q0":[0.315625,-0.503125,0.315625],"q1":[-0.315625,-0.503125,0.315625],"q3":[0.315625,-0.503125,-1.065625],"normal":[0,-1,0]},{"uv":[0.5,0.5,0.65625,0.84375],"q0":[0.315625,0.128125,0.315625],"q1":[-0.315625,0.128125,0.315625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,1,0]},{"uv":[0,0.84375,0.34375,1],"q0":[-0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,-1.065625],"normal":[-1,0,0]},{"uv":[0.34375,0.84375,0.5,1],"q0":[0.315625,-0.503125,-1.065625],"q1":[-0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,-1.065625],"normal":[0,0,-1]},{"uv":[0.5,0.84375,0.84375,1],"q0":[0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,-1.065625],"q3":[0.315625,0.128125,0.315625],"normal":[1,0,0]},{"uv":[0.84375,0.84375,1,1],"q0":[-0.315625,-0.503125,0.315625],"q1":[0.315625,-0.503125,0.315625],"q3":[-0.315625,0.128125,0.315625],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head_parts/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.109375,0.203125,0.203125,0.3125],"q0":[0.1875,-0.6875,0.3125],"q1":[-0.1875,-0.6875,0.3125],"q3":[0.1875,-0.6875,-0.125],"normal":[0,-1,0]},{"uv":[0.203125,0.203125,0.296875,0.3125],"q0":[0.1875,-0.375,0.3125],"q1":[-0.1875,-0.375,0.3125],"q3":[0.1875,-0.375,-0.125],"normal":[0,1,0]},{"uv":[0,0.3125,0.109375,0.390625],"q0":[-0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,-0.125],"normal":[-1,0,0]},{"uv":[0.109375,0.3125,0.203125,0.390625],"q0":[0.1875,-0.6875,-0.125],"q1":[-0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,-0.125],"normal":[0,0,-1]},{"uv":[0.203125,0.3125,0.3125,0.390625],"q0":[0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,-0.125],"q3":[0.1875,-0.375,0.3125],"normal":[1,0,0]},{"uv":[0.3125,0.3125,0.40625,0.390625],"q0":[-0.1875,-0.6875,0.3125],"q1":[0.1875,-0.6875,0.3125],"q3":[-0.1875,-0.375,0.3125],"normal":[0,0,1]}]}}},"wolf_body":{"textureSize":[64,32],"modelLayer":"WOLF_ARMOR","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.375,0.4375,0.46875,0.625],"q0":[0.2,-0.1375,0.2],"q1":[-0.2,-0.1375,0.2],"q3":[0.2,-0.1375,-0.2],"normal":[0,-1,0]},{"uv":[0.46875,0.4375,0.5625,0.625],"q0":[0.2,0.45,0.2],"q1":[-0.2,0.45,0.2],"q3":[0.2,0.45,-0.2],"normal":[0,1,0]},{"uv":[0.28125,0.625,0.375,0.90625],"q0":[-0.2,-0.1375,-0.2],"q1":[-0.2,-0.1375,0.2],"q3":[-0.2,0.45,-0.2],"normal":[-1,0,0]},{"uv":[0.375,0.625,0.46875,0.90625],"q0":[0.2,-0.1375,-0.2],"q1":[-0.2,-0.1375,-0.2],"q3":[0.2,0.45,-0.2],"normal":[0,0,-1]},{"uv":[0.46875,0.625,0.5625,0.90625],"q0":[0.2,-0.1375,0.2],"q1":[0.2,-0.1375,-0.2],"q3":[0.2,0.45,0.2],"normal":[1,0,0]},{"uv":[0.5625,0.625,0.65625,0.90625],"q0":[-0.2,-0.1375,0.2],"q1":[0.2,-0.1375,0.2],"q3":[-0.2,0.45,0.2],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head/real_head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0625,0,0.15625,0.125],"q0":[0.2625,-0.2,0.1375],"q1":[-0.1375,-0.2,0.1375],"q3":[0.2625,-0.2,-0.1375],"normal":[0,-1,0]},{"uv":[0.15625,0,0.25,0.125],"q0":[0.2625,0.2,0.1375],"q1":[-0.1375,0.2,0.1375],"q3":[0.2625,0.2,-0.1375],"normal":[0,1,0]},{"uv":[0,0.125,0.0625,0.3125],"q0":[-0.1375,-0.2,-0.1375],"q1":[-0.1375,-0.2,0.1375],"q3":[-0.1375,0.2,-0.1375],"normal":[-1,0,0]},{"uv":[0.0625,0.125,0.15625,0.3125],"q0":[0.2625,-0.2,-0.1375],"q1":[-0.1375,-0.2,-0.1375],"q3":[0.2625,0.2,-0.1375],"normal":[0,0,-1]},{"uv":[0.15625,0.125,0.21875,0.3125],"q0":[0.2625,-0.2,0.1375],"q1":[0.2625,-0.2,-0.1375],"q3":[0.2625,0.2,0.1375],"normal":[1,0,0]},{"uv":[0.21875,0.125,0.3125,0.3125],"q0":[-0.1375,-0.2,0.1375],"q1":[0.2625,-0.2,0.1375],"q3":[-0.1375,0.2,0.1375],"normal":[0,0,1]}]},"upper_body":{"label":"Upper body","path":"root/upper_body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.4375,0,0.5625,0.21875],"q0":[0.325,-0.2,0.2625],"q1":[-0.2,-0.2,0.2625],"q3":[0.325,-0.2,-0.2],"normal":[0,-1,0]},{"uv":[0.5625,0,0.6875,0.21875],"q0":[0.325,0.2,0.2625],"q1":[-0.2,0.2,0.2625],"q3":[0.325,0.2,-0.2],"normal":[0,1,0]},{"uv":[0.328125,0.21875,0.4375,0.40625],"q0":[-0.2,-0.2,-0.2],"q1":[-0.2,-0.2,0.2625],"q3":[-0.2,0.2,-0.2],"normal":[-1,0,0]},{"uv":[0.4375,0.21875,0.5625,0.40625],"q0":[0.325,-0.2,-0.2],"q1":[-0.2,-0.2,-0.2],"q3":[0.325,0.2,-0.2],"normal":[0,0,-1]},{"uv":[0.5625,0.21875,0.671875,0.40625],"q0":[0.325,-0.2,0.2625],"q1":[0.325,-0.2,-0.2],"q3":[0.325,0.2,0.2625],"normal":[1,0,0]},{"uv":[0.671875,0.21875,0.796875,0.40625],"q0":[-0.2,-0.2,0.2625],"q1":[0.325,-0.2,0.2625],"q3":[-0.2,0.2,0.2625],"normal":[0,0,1]}]},"legs":{"label":"Legs (repeated on all four)","path":"root/right_front_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.03125,0.5625,0.0625,0.625],"q0":[-0.0125,-0.0125,0.075],"q1":[0.1375,-0.0125,0.075],"q3":[-0.0125,-0.0125,-0.075],"normal":[0,-1,0]},{"uv":[0.0625,0.5625,0.09375,0.625],"q0":[-0.0125,0.5125,0.075],"q1":[0.1375,0.5125,0.075],"q3":[-0.0125,0.5125,-0.075],"normal":[0,1,0]},{"uv":[0,0.625,0.03125,0.875],"q0":[0.1375,-0.0125,-0.075],"q1":[0.1375,-0.0125,0.075],"q3":[0.1375,0.5125,-0.075],"normal":[1,0,0]},{"uv":[0.03125,0.625,0.0625,0.875],"q0":[-0.0125,-0.0125,-0.075],"q1":[0.1375,-0.0125,-0.075],"q3":[-0.0125,0.5125,-0.075],"normal":[0,0,-1]},{"uv":[0.0625,0.625,0.09375,0.875],"q0":[-0.0125,-0.0125,0.075],"q1":[-0.0125,-0.0125,-0.075],"q3":[-0.0125,0.5125,0.075],"normal":[-1,0,0]},{"uv":[0.09375,0.625,0.125,0.875],"q0":[0.1375,-0.0125,0.075],"q1":[-0.0125,-0.0125,0.075],"q3":[0.1375,0.5125,0.075],"normal":[0,0,1]}],"repeats":4},"tail":{"label":"Tail","path":"root/tail/real_tail","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.171875,0.5625,0.203125,0.625],"q0":[0.1375,-0.0125,0.075],"q1":[-0.0125,-0.0125,0.075],"q3":[0.1375,-0.0125,-0.075],"normal":[0,-1,0]},{"uv":[0.203125,0.5625,0.234375,0.625],"q0":[0.1375,0.5125,0.075],"q1":[-0.0125,0.5125,0.075],"q3":[0.1375,0.5125,-0.075],"normal":[0,1,0]},{"uv":[0.140625,0.625,0.171875,0.875],"q0":[-0.0125,-0.0125,-0.075],"q1":[-0.0125,-0.0125,0.075],"q3":[-0.0125,0.5125,-0.075],"normal":[-1,0,0]},{"uv":[0.171875,0.625,0.203125,0.875],"q0":[0.1375,-0.0125,-0.075],"q1":[-0.0125,-0.0125,-0.075],"q3":[0.1375,0.5125,-0.075],"normal":[0,0,-1]},{"uv":[0.203125,0.625,0.234375,0.875],"q0":[0.1375,-0.0125,0.075],"q1":[0.1375,-0.0125,-0.075],"q3":[0.1375,0.5125,0.075],"normal":[1,0,0]},{"uv":[0.234375,0.625,0.265625,0.875],"q0":[-0.0125,-0.0125,0.075],"q1":[0.1375,-0.0125,0.075],"q3":[-0.0125,0.5125,0.075],"normal":[0,0,1]}]}}},"llama_body":{"textureSize":[128,64],"modelLayer":"LLAMA_DECOR","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.3046875,0,0.3984375,0.15625],"q0":[0.40625,-0.65625,0.21875],"q1":[-0.40625,-0.65625,0.21875],"q3":[0.40625,-0.65625,-0.46875],"normal":[0,-1,0]},{"uv":[0.3984375,0,0.4921875,0.15625],"q0":[0.40625,0.53125,0.21875],"q1":[-0.40625,0.53125,0.21875],"q3":[0.40625,0.53125,-0.46875],"normal":[0,1,0]},{"uv":[0.2265625,0.15625,0.3046875,0.4375],"q0":[-0.40625,-0.65625,-0.46875],"q1":[-0.40625,-0.65625,0.21875],"q3":[-0.40625,0.53125,-0.46875],"normal":[-1,0,0]},{"uv":[0.3046875,0.15625,0.3984375,0.4375],"q0":[0.40625,-0.65625,-0.46875],"q1":[-0.40625,-0.65625,-0.46875],"q3":[0.40625,0.53125,-0.46875],"normal":[0,0,-1]},{"uv":[0.3984375,0.15625,0.4765625,0.4375],"q0":[0.40625,-0.65625,0.21875],"q1":[0.40625,-0.65625,-0.46875],"q3":[0.40625,0.53125,0.21875],"normal":[1,0,0]},{"uv":[0.4765625,0.15625,0.5703125,0.4375],"q0":[-0.40625,-0.65625,0.21875],"q1":[0.40625,-0.65625,0.21875],"q3":[-0.40625,0.53125,0.21875],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0703125,0,0.1015625,0.140625],"q0":[0.15625,-0.90625,-0.03125],"q1":[-0.15625,-0.90625,-0.03125],"q3":[0.15625,-0.90625,-0.65625],"normal":[0,-1,0]},{"uv":[0.1015625,0,0.1328125,0.140625],"q0":[0.15625,-0.59375,-0.03125],"q1":[-0.15625,-0.59375,-0.03125],"q3":[0.15625,-0.59375,-0.65625],"normal":[0,1,0]},{"uv":[0,0.140625,0.0703125,0.203125],"q0":[-0.15625,-0.90625,-0.65625],"q1":[-0.15625,-0.90625,-0.03125],"q3":[-0.15625,-0.59375,-0.65625],"normal":[-1,0,0]},{"uv":[0.0703125,0.140625,0.1015625,0.203125],"q0":[0.15625,-0.90625,-0.65625],"q1":[-0.15625,-0.90625,-0.65625],"q3":[0.15625,-0.59375,-0.65625],"normal":[0,0,-1]},{"uv":[0.1015625,0.140625,0.171875,0.203125],"q0":[0.15625,-0.90625,-0.03125],"q1":[0.15625,-0.90625,-0.65625],"q3":[0.15625,-0.59375,-0.03125],"normal":[1,0,0]},{"uv":[0.171875,0.140625,0.203125,0.203125],"q0":[-0.15625,-0.90625,-0.03125],"q1":[0.15625,-0.90625,-0.03125],"q3":[-0.15625,-0.59375,-0.03125],"normal":[0,0,1]}]},"legs":{"label":"Legs (repeated on all four)","path":"root/right_front_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.2578125,0.453125,0.2890625,0.515625],"q0":[0.15625,-0.03125,0.15625],"q1":[-0.15625,-0.03125,0.15625],"q3":[0.15625,-0.03125,-0.15625],"normal":[0,-1,0]},{"uv":[0.2890625,0.453125,0.3203125,0.515625],"q0":[0.15625,0.90625,0.15625],"q1":[-0.15625,0.90625,0.15625],"q3":[0.15625,0.90625,-0.15625],"normal":[0,1,0]},{"uv":[0.2265625,0.515625,0.2578125,0.734375],"q0":[-0.15625,-0.03125,-0.15625],"q1":[-0.15625,-0.03125,0.15625],"q3":[-0.15625,0.90625,-0.15625],"normal":[-1,0,0]},{"uv":[0.2578125,0.515625,0.2890625,0.734375],"q0":[0.15625,-0.03125,-0.15625],"q1":[-0.15625,-0.03125,-0.15625],"q3":[0.15625,0.90625,-0.15625],"normal":[0,0,-1]},{"uv":[0.2890625,0.515625,0.3203125,0.734375],"q0":[0.15625,-0.03125,0.15625],"q1":[0.15625,-0.03125,-0.15625],"q3":[0.15625,0.90625,0.15625],"normal":[1,0,0]},{"uv":[0.3203125,0.515625,0.3515625,0.734375],"q0":[-0.15625,-0.03125,0.15625],"q1":[0.15625,-0.03125,0.15625],"q3":[-0.15625,0.90625,0.15625],"normal":[0,0,1]}],"repeats":4}}},"happy_ghast_body":{"textureSize":[64,64],"modelLayer":"HAPPY_GHAST_HARNESS","defaultBinding":"harness","bindings":{"harness":{"label":"Harness","path":"root/harness","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.25,0,0.5,0.25],"q0":[0.5,-1,0.5],"q1":[-0.5,-1,0.5],"q3":[0.5,-1,-0.5],"normal":[0,-1,0]},{"uv":[0.5,0,0.75,0.25],"q0":[0.5,0,0.5],"q1":[-0.5,0,0.5],"q3":[0.5,0,-0.5],"normal":[0,1,0]},{"uv":[0,0.25,0.25,0.5],"q0":[-0.5,-1,-0.5],"q1":[-0.5,-1,0.5],"q3":[-0.5,0,-0.5],"normal":[-1,0,0]},{"uv":[0.25,0.25,0.5,0.5],"q0":[0.5,-1,-0.5],"q1":[-0.5,-1,-0.5],"q3":[0.5,0,-0.5],"normal":[0,0,-1]},{"uv":[0.5,0.25,0.75,0.5],"q0":[0.5,-1,0.5],"q1":[0.5,-1,-0.5],"q3":[0.5,0,0.5],"normal":[1,0,0]},{"uv":[0.75,0.25,1,0.5],"q0":[-0.5,-1,0.5],"q1":[0.5,-1,0.5],"q3":[-0.5,0,0.5],"normal":[0,0,1]}]},"goggles":{"label":"Goggles","path":"root/goggles","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.078125,0.5,0.328125,0.578125],"q0":[0.509375,-0.165625,0.165625],"q1":[-0.509375,-0.165625,0.165625],"q3":[0.509375,-0.165625,-0.165625],"normal":[0,-1,0]},{"uv":[0.328125,0.5,0.578125,0.578125],"q0":[0.509375,0.165625,0.165625],"q1":[-0.509375,0.165625,0.165625],"q3":[0.509375,0.165625,-0.165625],"normal":[0,1,0]},{"uv":[0,0.578125,0.078125,0.65625],"q0":[-0.509375,-0.165625,-0.165625],"q1":[-0.509375,-0.165625,0.165625],"q3":[-0.509375,0.165625,-0.165625],"normal":[-1,0,0]},{"uv":[0.078125,0.578125,0.328125,0.65625],"q0":[0.509375,-0.165625,-0.165625],"q1":[-0.509375,-0.165625,-0.165625],"q3":[0.509375,0.165625,-0.165625],"normal":[0,0,-1]},{"uv":[0.328125,0.578125,0.40625,0.65625],"q0":[0.509375,-0.165625,0.165625],"q1":[0.509375,-0.165625,-0.165625],"q3":[0.509375,0.165625,0.165625],"normal":[1,0,0]},{"uv":[0.40625,0.578125,0.65625,0.65625],"q0":[-0.509375,-0.165625,0.165625],"q1":[0.509375,-0.165625,0.165625],"q3":[-0.509375,0.165625,0.165625],"normal":[0,0,1]}]}}},"wings":{"textureSize":[64,32],"modelLayer":"ELYTRA","defaultBinding":"wings","bindings":{"wings":{"label":"Wings (mirrored pair)","path":"root/left_wing","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.375,0,0.53125,0.0625],"q0":[0.0625,-0.0625,0.1875],"q1":[-0.6875,-0.0625,0.1875],"q3":[0.0625,-0.0625,-0.0625],"normal":[0,-1,0]},{"uv":[0.53125,0,0.6875,0.0625],"q0":[0.0625,1.3125,0.1875],"q1":[-0.6875,1.3125,0.1875],"q3":[0.0625,1.3125,-0.0625],"normal":[0,1,0]},{"uv":[0.34375,0.0625,0.375,0.6875],"q0":[-0.6875,-0.0625,-0.0625],"q1":[-0.6875,-0.0625,0.1875],"q3":[-0.6875,1.3125,-0.0625],"normal":[-1,0,0]},{"uv":[0.375,0.0625,0.53125,0.6875],"q0":[0.0625,-0.0625,-0.0625],"q1":[-0.6875,-0.0625,-0.0625],"q3":[0.0625,1.3125,-0.0625],"normal":[0,0,-1]},{"uv":[0.53125,0.0625,0.5625,0.6875],"q0":[0.0625,-0.0625,0.1875],"q1":[0.0625,-0.0625,-0.0625],"q3":[0.0625,1.3125,0.1875],"normal":[1,0,0]},{"uv":[0.5625,0.0625,0.71875,0.6875],"q0":[-0.6875,-0.0625,0.1875],"q1":[0.0625,-0.0625,0.1875],"q3":[-0.6875,1.3125,0.1875],"normal":[0,0,1]}],"repeats":2}}},"camel_saddle":{"textureSize":[128,128],"modelLayer":"CAMEL_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.2109375,0.1953125,0.328125,0.40625],"q0":[0.46875,-0.75,0.21875],"q1":[-0.46875,-0.75,0.21875],"q3":[0.46875,-0.75,-1.46875],"normal":[0,-1,0]},{"uv":[0.328125,0.1953125,0.4453125,0.40625],"q0":[0.46875,0,0.21875],"q1":[-0.46875,0,0.21875],"q3":[0.46875,0,-1.46875],"normal":[0,1,0]},{"uv":[0,0.40625,0.2109375,0.5],"q0":[-0.46875,-0.75,-1.46875],"q1":[-0.46875,-0.75,0.21875],"q3":[-0.46875,0,-1.46875],"normal":[-1,0,0]},{"uv":[0.2109375,0.40625,0.328125,0.5],"q0":[0.46875,-0.75,-1.46875],"q1":[-0.46875,-0.75,-1.46875],"q3":[0.46875,0,-1.46875],"normal":[0,0,-1]},{"uv":[0.328125,0.40625,0.5390625,0.5],"q0":[0.46875,-0.75,0.21875],"q1":[0.46875,-0.75,-1.46875],"q3":[0.46875,0,0.21875],"normal":[1,0,0]},{"uv":[0.5390625,0.40625,0.65625,0.5],"q0":[-0.46875,-0.75,0.21875],"q1":[0.46875,-0.75,0.21875],"q3":[-0.46875,0,0.21875],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/body/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.6171875,0.1875,0.671875,0.3359375],"q0":[0.21875,-0.4375,0.25],"q1":[-0.21875,-0.4375,0.25],"q3":[0.21875,-0.4375,-0.9375],"normal":[0,-1,0]},{"uv":[0.671875,0.1875,0.7265625,0.3359375],"q0":[0.21875,0.0625,0.25],"q1":[-0.21875,0.0625,0.25],"q3":[0.21875,0.0625,-0.9375],"normal":[0,1,0]},{"uv":[0.46875,0.3359375,0.6171875,0.3984375],"q0":[-0.21875,-0.4375,-0.9375],"q1":[-0.21875,-0.4375,0.25],"q3":[-0.21875,0.0625,-0.9375],"normal":[-1,0,0]},{"uv":[0.6171875,0.3359375,0.671875,0.3984375],"q0":[0.21875,-0.4375,-0.9375],"q1":[-0.21875,-0.4375,-0.9375],"q3":[0.21875,0.0625,-0.9375],"normal":[0,0,-1]},{"uv":[0.671875,0.3359375,0.8203125,0.3984375],"q0":[0.21875,-0.4375,0.25],"q1":[0.21875,-0.4375,-0.9375],"q3":[0.21875,0.0625,0.25],"normal":[1,0,0]},{"uv":[0.8203125,0.3359375,0.875,0.3984375],"q0":[-0.21875,-0.4375,0.25],"q1":[0.21875,-0.4375,0.25],"q3":[-0.21875,0.0625,0.25],"normal":[0,0,1]}]},"left_ear":{"label":"Left ear","path":"root/body/head/left_ear","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.3671875,0,0.390625,0.015625],"q0":[0.15625,0.03125,0.0625],"q1":[-0.03125,0.03125,0.0625],"q3":[0.15625,0.03125,-0.0625],"normal":[0,-1,0]},{"uv":[0.390625,0,0.4140625,0.015625],"q0":[0.15625,0.09375,0.0625],"q1":[-0.03125,0.09375,0.0625],"q3":[0.15625,0.09375,-0.0625],"normal":[0,1,0]},{"uv":[0.3515625,0.015625,0.3671875,0.0234375],"q0":[-0.03125,0.03125,-0.0625],"q1":[-0.03125,0.03125,0.0625],"q3":[-0.03125,0.09375,-0.0625],"normal":[-1,0,0]},{"uv":[0.3671875,0.015625,0.390625,0.0234375],"q0":[0.15625,0.03125,-0.0625],"q1":[-0.03125,0.03125,-0.0625],"q3":[0.15625,0.09375,-0.0625],"normal":[0,0,-1]},{"uv":[0.390625,0.015625,0.40625,0.0234375],"q0":[0.15625,0.03125,0.0625],"q1":[0.15625,0.03125,-0.0625],"q3":[0.15625,0.09375,0.0625],"normal":[1,0,0]},{"uv":[0.40625,0.015625,0.4296875,0.0234375],"q0":[-0.03125,0.03125,0.0625],"q1":[0.15625,0.03125,0.0625],"q3":[-0.03125,0.09375,0.0625],"normal":[0,0,1]}]},"right_ear":{"label":"Right ear","path":"root/body/head/right_ear","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.5390625,0,0.5625,0.015625],"q0":[0.03125,0.03125,0.0625],"q1":[-0.15625,0.03125,0.0625],"q3":[0.03125,0.03125,-0.0625],"normal":[0,-1,0]},{"uv":[0.5625,0,0.5859375,0.015625],"q0":[0.03125,0.09375,0.0625],"q1":[-0.15625,0.09375,0.0625],"q3":[0.03125,0.09375,-0.0625],"normal":[0,1,0]},{"uv":[0.5234375,0.015625,0.5390625,0.0234375],"q0":[-0.15625,0.03125,-0.0625],"q1":[-0.15625,0.03125,0.0625],"q3":[-0.15625,0.09375,-0.0625],"normal":[-1,0,0]},{"uv":[0.5390625,0.015625,0.5625,0.0234375],"q0":[0.03125,0.03125,-0.0625],"q1":[-0.15625,0.03125,-0.0625],"q3":[0.03125,0.09375,-0.0625],"normal":[0,0,-1]},{"uv":[0.5625,0.015625,0.578125,0.0234375],"q0":[0.03125,0.03125,0.0625],"q1":[0.03125,0.03125,-0.0625],"q3":[0.03125,0.09375,0.0625],"normal":[1,0,0]},{"uv":[0.578125,0.015625,0.6015625,0.0234375],"q0":[-0.15625,0.03125,0.0625],"q1":[0.03125,0.03125,0.0625],"q3":[-0.15625,0.09375,0.0625],"normal":[0,0,1]}]},"reins":{"label":"Reins (with rider)","path":"root/body/head/reins","cubeIndex":1,"pivot":[0,0,0],"quads":[{"uv":[0.65625,0.4453125,0.7109375,0.5],"q0":[0.21875,-1.125,-0.125],"q1":[-0.21875,-1.125,-0.125],"q3":[0.21875,-0.6875,-0.125],"normal":[0,0,-1]},{"uv":[0.7109375,0.4453125,0.765625,0.5],"q0":[-0.21875,-1.125,-0.125],"q1":[0.21875,-1.125,-0.125],"q3":[-0.21875,-0.6875,-0.125],"normal":[0,0,1]}],"visibleWhen":"ridden"},"right_front_leg":{"label":"Right front leg","path":"root/right_front_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0390625,0.203125,0.078125,0.2421875],"q0":[0.15625,0.125,0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[0.15625,0.125,-0.15625],"normal":[0,-1,0]},{"uv":[0.078125,0.203125,0.1171875,0.2421875],"q0":[0.15625,1.4375,0.15625],"q1":[-0.15625,1.4375,0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,1,0]},{"uv":[0,0.2421875,0.0390625,0.40625],"q0":[-0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,-0.15625],"normal":[-1,0,0]},{"uv":[0.0390625,0.2421875,0.078125,0.40625],"q0":[0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,0,-1]},{"uv":[0.078125,0.2421875,0.1171875,0.40625],"q0":[0.15625,0.125,0.15625],"q1":[0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,0.15625],"normal":[1,0,0]},{"uv":[0.1171875,0.2421875,0.15625,0.40625],"q0":[-0.15625,0.125,0.15625],"q1":[0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,0.15625],"normal":[0,0,1]}]},"left_front_leg":{"label":"Left front leg","path":"root/left_front_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0390625,0,0.078125,0.0390625],"q0":[0.15625,0.125,0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[0.15625,0.125,-0.15625],"normal":[0,-1,0]},{"uv":[0.078125,0,0.1171875,0.0390625],"q0":[0.15625,1.4375,0.15625],"q1":[-0.15625,1.4375,0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,1,0]},{"uv":[0,0.0390625,0.0390625,0.203125],"q0":[-0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,-0.15625],"normal":[-1,0,0]},{"uv":[0.0390625,0.0390625,0.078125,0.203125],"q0":[0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,0,-1]},{"uv":[0.078125,0.0390625,0.1171875,0.203125],"q0":[0.15625,0.125,0.15625],"q1":[0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,0.15625],"normal":[1,0,0]},{"uv":[0.1171875,0.0390625,0.15625,0.203125],"q0":[-0.15625,0.125,0.15625],"q1":[0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,0.15625],"normal":[0,0,1]}]},"right_hind_leg":{"label":"Right hind leg","path":"root/right_hind_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.7734375,0.125,0.8125,0.1640625],"q0":[0.15625,0.125,0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[0.15625,0.125,-0.15625],"normal":[0,-1,0]},{"uv":[0.8125,0.125,0.8515625,0.1640625],"q0":[0.15625,1.4375,0.15625],"q1":[-0.15625,1.4375,0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,1,0]},{"uv":[0.734375,0.1640625,0.7734375,0.328125],"q0":[-0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,-0.15625],"normal":[-1,0,0]},{"uv":[0.7734375,0.1640625,0.8125,0.328125],"q0":[0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,0,-1]},{"uv":[0.8125,0.1640625,0.8515625,0.328125],"q0":[0.15625,0.125,0.15625],"q1":[0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,0.15625],"normal":[1,0,0]},{"uv":[0.8515625,0.1640625,0.890625,0.328125],"q0":[-0.15625,0.125,0.15625],"q1":[0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,0.15625],"normal":[0,0,1]}]},"left_hind_leg":{"label":"Left hind leg","path":"root/left_hind_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.4921875,0.125,0.53125,0.1640625],"q0":[0.15625,0.125,0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[0.15625,0.125,-0.15625],"normal":[0,-1,0]},{"uv":[0.53125,0.125,0.5703125,0.1640625],"q0":[0.15625,1.4375,0.15625],"q1":[-0.15625,1.4375,0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,1,0]},{"uv":[0.453125,0.1640625,0.4921875,0.328125],"q0":[-0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,-0.15625],"normal":[-1,0,0]},{"uv":[0.4921875,0.1640625,0.53125,0.328125],"q0":[0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,0,-1]},{"uv":[0.53125,0.1640625,0.5703125,0.328125],"q0":[0.15625,0.125,0.15625],"q1":[0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,0.15625],"normal":[1,0,0]},{"uv":[0.5703125,0.1640625,0.609375,0.328125],"q0":[-0.15625,0.125,0.15625],"q1":[0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,0.15625],"normal":[0,0,1]}]}}},"camel_husk_saddle":{"textureSize":[128,128],"modelLayer":"CAMEL_HUSK_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.2109375,0.1953125,0.328125,0.40625],"q0":[0.46875,-0.75,0.21875],"q1":[-0.46875,-0.75,0.21875],"q3":[0.46875,-0.75,-1.46875],"normal":[0,-1,0]},{"uv":[0.328125,0.1953125,0.4453125,0.40625],"q0":[0.46875,0,0.21875],"q1":[-0.46875,0,0.21875],"q3":[0.46875,0,-1.46875],"normal":[0,1,0]},{"uv":[0,0.40625,0.2109375,0.5],"q0":[-0.46875,-0.75,-1.46875],"q1":[-0.46875,-0.75,0.21875],"q3":[-0.46875,0,-1.46875],"normal":[-1,0,0]},{"uv":[0.2109375,0.40625,0.328125,0.5],"q0":[0.46875,-0.75,-1.46875],"q1":[-0.46875,-0.75,-1.46875],"q3":[0.46875,0,-1.46875],"normal":[0,0,-1]},{"uv":[0.328125,0.40625,0.5390625,0.5],"q0":[0.46875,-0.75,0.21875],"q1":[0.46875,-0.75,-1.46875],"q3":[0.46875,0,0.21875],"normal":[1,0,0]},{"uv":[0.5390625,0.40625,0.65625,0.5],"q0":[-0.46875,-0.75,0.21875],"q1":[0.46875,-0.75,0.21875],"q3":[-0.46875,0,0.21875],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/body/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.6171875,0.1875,0.671875,0.3359375],"q0":[0.21875,-0.4375,0.25],"q1":[-0.21875,-0.4375,0.25],"q3":[0.21875,-0.4375,-0.9375],"normal":[0,-1,0]},{"uv":[0.671875,0.1875,0.7265625,0.3359375],"q0":[0.21875,0.0625,0.25],"q1":[-0.21875,0.0625,0.25],"q3":[0.21875,0.0625,-0.9375],"normal":[0,1,0]},{"uv":[0.46875,0.3359375,0.6171875,0.3984375],"q0":[-0.21875,-0.4375,-0.9375],"q1":[-0.21875,-0.4375,0.25],"q3":[-0.21875,0.0625,-0.9375],"normal":[-1,0,0]},{"uv":[0.6171875,0.3359375,0.671875,0.3984375],"q0":[0.21875,-0.4375,-0.9375],"q1":[-0.21875,-0.4375,-0.9375],"q3":[0.21875,0.0625,-0.9375],"normal":[0,0,-1]},{"uv":[0.671875,0.3359375,0.8203125,0.3984375],"q0":[0.21875,-0.4375,0.25],"q1":[0.21875,-0.4375,-0.9375],"q3":[0.21875,0.0625,0.25],"normal":[1,0,0]},{"uv":[0.8203125,0.3359375,0.875,0.3984375],"q0":[-0.21875,-0.4375,0.25],"q1":[0.21875,-0.4375,0.25],"q3":[-0.21875,0.0625,0.25],"normal":[0,0,1]}]},"left_ear":{"label":"Left ear","path":"root/body/head/left_ear","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.3671875,0,0.390625,0.015625],"q0":[0.15625,0.03125,0.0625],"q1":[-0.03125,0.03125,0.0625],"q3":[0.15625,0.03125,-0.0625],"normal":[0,-1,0]},{"uv":[0.390625,0,0.4140625,0.015625],"q0":[0.15625,0.09375,0.0625],"q1":[-0.03125,0.09375,0.0625],"q3":[0.15625,0.09375,-0.0625],"normal":[0,1,0]},{"uv":[0.3515625,0.015625,0.3671875,0.0234375],"q0":[-0.03125,0.03125,-0.0625],"q1":[-0.03125,0.03125,0.0625],"q3":[-0.03125,0.09375,-0.0625],"normal":[-1,0,0]},{"uv":[0.3671875,0.015625,0.390625,0.0234375],"q0":[0.15625,0.03125,-0.0625],"q1":[-0.03125,0.03125,-0.0625],"q3":[0.15625,0.09375,-0.0625],"normal":[0,0,-1]},{"uv":[0.390625,0.015625,0.40625,0.0234375],"q0":[0.15625,0.03125,0.0625],"q1":[0.15625,0.03125,-0.0625],"q3":[0.15625,0.09375,0.0625],"normal":[1,0,0]},{"uv":[0.40625,0.015625,0.4296875,0.0234375],"q0":[-0.03125,0.03125,0.0625],"q1":[0.15625,0.03125,0.0625],"q3":[-0.03125,0.09375,0.0625],"normal":[0,0,1]}]},"right_ear":{"label":"Right ear","path":"root/body/head/right_ear","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.5390625,0,0.5625,0.015625],"q0":[0.03125,0.03125,0.0625],"q1":[-0.15625,0.03125,0.0625],"q3":[0.03125,0.03125,-0.0625],"normal":[0,-1,0]},{"uv":[0.5625,0,0.5859375,0.015625],"q0":[0.03125,0.09375,0.0625],"q1":[-0.15625,0.09375,0.0625],"q3":[0.03125,0.09375,-0.0625],"normal":[0,1,0]},{"uv":[0.5234375,0.015625,0.5390625,0.0234375],"q0":[-0.15625,0.03125,-0.0625],"q1":[-0.15625,0.03125,0.0625],"q3":[-0.15625,0.09375,-0.0625],"normal":[-1,0,0]},{"uv":[0.5390625,0.015625,0.5625,0.0234375],"q0":[0.03125,0.03125,-0.0625],"q1":[-0.15625,0.03125,-0.0625],"q3":[0.03125,0.09375,-0.0625],"normal":[0,0,-1]},{"uv":[0.5625,0.015625,0.578125,0.0234375],"q0":[0.03125,0.03125,0.0625],"q1":[0.03125,0.03125,-0.0625],"q3":[0.03125,0.09375,0.0625],"normal":[1,0,0]},{"uv":[0.578125,0.015625,0.6015625,0.0234375],"q0":[-0.15625,0.03125,0.0625],"q1":[0.03125,0.03125,0.0625],"q3":[-0.15625,0.09375,0.0625],"normal":[0,0,1]}]},"reins":{"label":"Reins (with rider)","path":"root/body/head/reins","cubeIndex":1,"pivot":[0,0,0],"quads":[{"uv":[0.65625,0.4453125,0.7109375,0.5],"q0":[0.21875,-1.125,-0.125],"q1":[-0.21875,-1.125,-0.125],"q3":[0.21875,-0.6875,-0.125],"normal":[0,0,-1]},{"uv":[0.7109375,0.4453125,0.765625,0.5],"q0":[-0.21875,-1.125,-0.125],"q1":[0.21875,-1.125,-0.125],"q3":[-0.21875,-0.6875,-0.125],"normal":[0,0,1]}],"visibleWhen":"ridden"},"right_front_leg":{"label":"Right front leg","path":"root/right_front_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0390625,0.203125,0.078125,0.2421875],"q0":[0.15625,0.125,0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[0.15625,0.125,-0.15625],"normal":[0,-1,0]},{"uv":[0.078125,0.203125,0.1171875,0.2421875],"q0":[0.15625,1.4375,0.15625],"q1":[-0.15625,1.4375,0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,1,0]},{"uv":[0,0.2421875,0.0390625,0.40625],"q0":[-0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,-0.15625],"normal":[-1,0,0]},{"uv":[0.0390625,0.2421875,0.078125,0.40625],"q0":[0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,0,-1]},{"uv":[0.078125,0.2421875,0.1171875,0.40625],"q0":[0.15625,0.125,0.15625],"q1":[0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,0.15625],"normal":[1,0,0]},{"uv":[0.1171875,0.2421875,0.15625,0.40625],"q0":[-0.15625,0.125,0.15625],"q1":[0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,0.15625],"normal":[0,0,1]}]},"left_front_leg":{"label":"Left front leg","path":"root/left_front_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0390625,0,0.078125,0.0390625],"q0":[0.15625,0.125,0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[0.15625,0.125,-0.15625],"normal":[0,-1,0]},{"uv":[0.078125,0,0.1171875,0.0390625],"q0":[0.15625,1.4375,0.15625],"q1":[-0.15625,1.4375,0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,1,0]},{"uv":[0,0.0390625,0.0390625,0.203125],"q0":[-0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,-0.15625],"normal":[-1,0,0]},{"uv":[0.0390625,0.0390625,0.078125,0.203125],"q0":[0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,0,-1]},{"uv":[0.078125,0.0390625,0.1171875,0.203125],"q0":[0.15625,0.125,0.15625],"q1":[0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,0.15625],"normal":[1,0,0]},{"uv":[0.1171875,0.0390625,0.15625,0.203125],"q0":[-0.15625,0.125,0.15625],"q1":[0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,0.15625],"normal":[0,0,1]}]},"right_hind_leg":{"label":"Right hind leg","path":"root/right_hind_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.7734375,0.125,0.8125,0.1640625],"q0":[0.15625,0.125,0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[0.15625,0.125,-0.15625],"normal":[0,-1,0]},{"uv":[0.8125,0.125,0.8515625,0.1640625],"q0":[0.15625,1.4375,0.15625],"q1":[-0.15625,1.4375,0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,1,0]},{"uv":[0.734375,0.1640625,0.7734375,0.328125],"q0":[-0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,-0.15625],"normal":[-1,0,0]},{"uv":[0.7734375,0.1640625,0.8125,0.328125],"q0":[0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,0,-1]},{"uv":[0.8125,0.1640625,0.8515625,0.328125],"q0":[0.15625,0.125,0.15625],"q1":[0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,0.15625],"normal":[1,0,0]},{"uv":[0.8515625,0.1640625,0.890625,0.328125],"q0":[-0.15625,0.125,0.15625],"q1":[0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,0.15625],"normal":[0,0,1]}]},"left_hind_leg":{"label":"Left hind leg","path":"root/left_hind_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.4921875,0.125,0.53125,0.1640625],"q0":[0.15625,0.125,0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[0.15625,0.125,-0.15625],"normal":[0,-1,0]},{"uv":[0.53125,0.125,0.5703125,0.1640625],"q0":[0.15625,1.4375,0.15625],"q1":[-0.15625,1.4375,0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,1,0]},{"uv":[0.453125,0.1640625,0.4921875,0.328125],"q0":[-0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,-0.15625],"normal":[-1,0,0]},{"uv":[0.4921875,0.1640625,0.53125,0.328125],"q0":[0.15625,0.125,-0.15625],"q1":[-0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,-0.15625],"normal":[0,0,-1]},{"uv":[0.53125,0.1640625,0.5703125,0.328125],"q0":[0.15625,0.125,0.15625],"q1":[0.15625,0.125,-0.15625],"q3":[0.15625,1.4375,0.15625],"normal":[1,0,0]},{"uv":[0.5703125,0.1640625,0.609375,0.328125],"q0":[-0.15625,0.125,0.15625],"q1":[0.15625,0.125,0.15625],"q3":[-0.15625,1.4375,0.15625],"normal":[0,0,1]}]}}},"pig_saddle":{"textureSize":[64,64],"modelLayer":"PIG_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.5625,0.125,0.71875,0.25],"q0":[0.34375,-0.65625,0.09375],"q1":[-0.34375,-0.65625,0.09375],"q3":[0.34375,-0.65625,-0.46875],"normal":[0,-1,0]},{"uv":[0.71875,0.125,0.875,0.25],"q0":[0.34375,0.40625,0.09375],"q1":[-0.34375,0.40625,0.09375],"q3":[0.34375,0.40625,-0.46875],"normal":[0,1,0]},{"uv":[0.4375,0.25,0.5625,0.5],"q0":[-0.34375,-0.65625,-0.46875],"q1":[-0.34375,-0.65625,0.09375],"q3":[-0.34375,0.40625,-0.46875],"normal":[-1,0,0]},{"uv":[0.5625,0.25,0.71875,0.5],"q0":[0.34375,-0.65625,-0.46875],"q1":[-0.34375,-0.65625,-0.46875],"q3":[0.34375,0.40625,-0.46875],"normal":[0,0,-1]},{"uv":[0.71875,0.25,0.84375,0.5],"q0":[0.34375,-0.65625,0.09375],"q1":[0.34375,-0.65625,-0.46875],"q3":[0.34375,0.40625,0.09375],"normal":[1,0,0]},{"uv":[0.84375,0.25,1,0.5],"q0":[-0.34375,-0.65625,0.09375],"q1":[0.34375,-0.65625,0.09375],"q3":[-0.34375,0.40625,0.09375],"normal":[0,0,1]}]},"head":{"label":"Head","path":"root/head","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.125,0,0.25,0.125],"q0":[0.28125,-0.28125,0.03125],"q1":[-0.28125,-0.28125,0.03125],"q3":[0.28125,-0.28125,-0.53125],"normal":[0,-1,0]},{"uv":[0.25,0,0.375,0.125],"q0":[0.28125,0.28125,0.03125],"q1":[-0.28125,0.28125,0.03125],"q3":[0.28125,0.28125,-0.53125],"normal":[0,1,0]},{"uv":[0,0.125,0.125,0.25],"q0":[-0.28125,-0.28125,-0.53125],"q1":[-0.28125,-0.28125,0.03125],"q3":[-0.28125,0.28125,-0.53125],"normal":[-1,0,0]},{"uv":[0.125,0.125,0.25,0.25],"q0":[0.28125,-0.28125,-0.53125],"q1":[-0.28125,-0.28125,-0.53125],"q3":[0.28125,0.28125,-0.53125],"normal":[0,0,-1]},{"uv":[0.25,0.125,0.375,0.25],"q0":[0.28125,-0.28125,0.03125],"q1":[0.28125,-0.28125,-0.53125],"q3":[0.28125,0.28125,0.03125],"normal":[1,0,0]},{"uv":[0.375,0.125,0.5,0.25],"q0":[-0.28125,-0.28125,0.03125],"q1":[0.28125,-0.28125,0.03125],"q3":[-0.28125,0.28125,0.03125],"normal":[0,0,1]}]},"legs":{"label":"Legs (repeated on all four)","path":"root/right_front_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0625,0.25,0.125,0.3125],"q0":[0.15625,-0.03125,0.15625],"q1":[-0.15625,-0.03125,0.15625],"q3":[0.15625,-0.03125,-0.15625],"normal":[0,-1,0]},{"uv":[0.125,0.25,0.1875,0.3125],"q0":[0.15625,0.40625,0.15625],"q1":[-0.15625,0.40625,0.15625],"q3":[0.15625,0.40625,-0.15625],"normal":[0,1,0]},{"uv":[0,0.3125,0.0625,0.40625],"q0":[-0.15625,-0.03125,-0.15625],"q1":[-0.15625,-0.03125,0.15625],"q3":[-0.15625,0.40625,-0.15625],"normal":[-1,0,0]},{"uv":[0.0625,0.3125,0.125,0.40625],"q0":[0.15625,-0.03125,-0.15625],"q1":[-0.15625,-0.03125,-0.15625],"q3":[0.15625,0.40625,-0.15625],"normal":[0,0,-1]},{"uv":[0.125,0.3125,0.1875,0.40625],"q0":[0.15625,-0.03125,0.15625],"q1":[0.15625,-0.03125,-0.15625],"q3":[0.15625,0.40625,0.15625],"normal":[1,0,0]},{"uv":[0.1875,0.3125,0.25,0.40625],"q0":[-0.15625,-0.03125,0.15625],"q1":[0.15625,-0.03125,0.15625],"q3":[-0.15625,0.40625,0.15625],"normal":[0,0,1]}],"repeats":4}}},"strider_saddle":{"textureSize":[64,128],"modelLayer":"STRIDER_SADDLE","defaultBinding":"body","bindings":{"body":{"label":"Body","path":"root/body","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.25,0,0.5,0.125],"q0":[0.5,-0.375,0.5],"q1":[-0.5,-0.375,0.5],"q3":[0.5,-0.375,-0.5],"normal":[0,-1,0]},{"uv":[0.5,0,0.75,0.125],"q0":[0.5,0.5,0.5],"q1":[-0.5,0.5,0.5],"q3":[0.5,0.5,-0.5],"normal":[0,1,0]},{"uv":[0,0.125,0.25,0.234375],"q0":[-0.5,-0.375,-0.5],"q1":[-0.5,-0.375,0.5],"q3":[-0.5,0.5,-0.5],"normal":[-1,0,0]},{"uv":[0.25,0.125,0.5,0.234375],"q0":[0.5,-0.375,-0.5],"q1":[-0.5,-0.375,-0.5],"q3":[0.5,0.5,-0.5],"normal":[0,0,-1]},{"uv":[0.5,0.125,0.75,0.234375],"q0":[0.5,-0.375,0.5],"q1":[0.5,-0.375,-0.5],"q3":[0.5,0.5,0.5],"normal":[1,0,0]},{"uv":[0.75,0.125,1,0.234375],"q0":[-0.5,-0.375,0.5],"q1":[0.5,-0.375,0.5],"q3":[-0.5,0.5,0.5],"normal":[0,0,1]}]},"right_leg":{"label":"Right leg","path":"root/right_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0625,0.25,0.125,0.28125],"q0":[0.125,0,0.125],"q1":[-0.125,0,0.125],"q3":[0.125,0,-0.125],"normal":[0,-1,0]},{"uv":[0.125,0.25,0.1875,0.28125],"q0":[0.125,1,0.125],"q1":[-0.125,1,0.125],"q3":[0.125,1,-0.125],"normal":[0,1,0]},{"uv":[0,0.28125,0.0625,0.40625],"q0":[-0.125,0,-0.125],"q1":[-0.125,0,0.125],"q3":[-0.125,1,-0.125],"normal":[-1,0,0]},{"uv":[0.0625,0.28125,0.125,0.40625],"q0":[0.125,0,-0.125],"q1":[-0.125,0,-0.125],"q3":[0.125,1,-0.125],"normal":[0,0,-1]},{"uv":[0.125,0.28125,0.1875,0.40625],"q0":[0.125,0,0.125],"q1":[0.125,0,-0.125],"q3":[0.125,1,0.125],"normal":[1,0,0]},{"uv":[0.1875,0.28125,0.25,0.40625],"q0":[-0.125,0,0.125],"q1":[0.125,0,0.125],"q3":[-0.125,1,0.125],"normal":[0,0,1]}]},"left_leg":{"label":"Left leg","path":"root/left_leg","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.0625,0.4296875,0.125,0.4609375],"q0":[0.125,0,0.125],"q1":[-0.125,0,0.125],"q3":[0.125,0,-0.125],"normal":[0,-1,0]},{"uv":[0.125,0.4296875,0.1875,0.4609375],"q0":[0.125,1,0.125],"q1":[-0.125,1,0.125],"q3":[0.125,1,-0.125],"normal":[0,1,0]},{"uv":[0,0.4609375,0.0625,0.5859375],"q0":[-0.125,0,-0.125],"q1":[-0.125,0,0.125],"q3":[-0.125,1,-0.125],"normal":[-1,0,0]},{"uv":[0.0625,0.4609375,0.125,0.5859375],"q0":[0.125,0,-0.125],"q1":[-0.125,0,-0.125],"q3":[0.125,1,-0.125],"normal":[0,0,-1]},{"uv":[0.125,0.4609375,0.1875,0.5859375],"q0":[0.125,0,0.125],"q1":[0.125,0,-0.125],"q3":[0.125,1,0.125],"normal":[1,0,0]},{"uv":[0.1875,0.4609375,0.25,0.5859375],"q0":[-0.125,0,0.125],"q1":[0.125,0,0.125],"q3":[-0.125,1,0.125],"normal":[0,0,1]}]}}},"nautilus_body":{"textureSize":[128,128],"modelLayer":"NAUTILUS_ARMOR","defaultBinding":"shell","bindings":{"shell":{"label":"Shell","path":"root/root/shell","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.125,0,0.234375,0.125],"q0":[0.438125,-0.625625,0.563125],"q1":[-0.438125,-0.625625,0.563125],"q3":[0.438125,-0.625625,-0.438125],"normal":[0,-1,0]},{"uv":[0.234375,0,0.34375,0.125],"q0":[0.438125,0.000625,0.563125],"q1":[-0.438125,0.000625,0.563125],"q3":[0.438125,0.000625,-0.438125],"normal":[0,1,0]},{"uv":[0,0.125,0.125,0.203125],"q0":[-0.438125,-0.625625,-0.438125],"q1":[-0.438125,-0.625625,0.563125],"q3":[-0.438125,0.000625,-0.438125],"normal":[-1,0,0]},{"uv":[0.125,0.125,0.234375,0.203125],"q0":[0.438125,-0.625625,-0.438125],"q1":[-0.438125,-0.625625,-0.438125],"q3":[0.438125,0.000625,-0.438125],"normal":[0,0,-1]},{"uv":[0.234375,0.125,0.359375,0.203125],"q0":[0.438125,-0.625625,0.563125],"q1":[0.438125,-0.625625,-0.438125],"q3":[0.438125,0.000625,0.563125],"normal":[1,0,0]},{"uv":[0.359375,0.125,0.46875,0.203125],"q0":[-0.438125,-0.625625,0.563125],"q1":[0.438125,-0.625625,0.563125],"q3":[-0.438125,0.000625,0.563125],"normal":[0,0,1]}]}}},"nautilus_saddle":{"textureSize":[128,128],"modelLayer":"NAUTILUS_SADDLE","defaultBinding":"shell","bindings":{"shell":{"label":"Shell","path":"root/root/shell","cubeIndex":0,"pivot":[0,0,0],"quads":[{"uv":[0.125,0,0.234375,0.125],"q0":[0.45,-0.6375,0.575],"q1":[-0.45,-0.6375,0.575],"q3":[0.45,-0.6375,-0.45],"normal":[0,-1,0]},{"uv":[0.234375,0,0.34375,0.125],"q0":[0.45,0.0125,0.575],"q1":[-0.45,0.0125,0.575],"q3":[0.45,0.0125,-0.45],"normal":[0,1,0]},{"uv":[0,0.125,0.125,0.203125],"q0":[-0.45,-0.6375,-0.45],"q1":[-0.45,-0.6375,0.575],"q3":[-0.45,0.0125,-0.45],"normal":[-1,0,0]},{"uv":[0.125,0.125,0.234375,0.203125],"q0":[0.45,-0.6375,-0.45],"q1":[-0.45,-0.6375,-0.45],"q3":[0.45,0.0125,-0.45],"normal":[0,0,-1]},{"uv":[0.234375,0.125,0.359375,0.203125],"q0":[0.45,-0.6375,0.575],"q1":[0.45,-0.6375,-0.45],"q3":[0.45,0.0125,0.575],"normal":[1,0,0]},{"uv":[0.359375,0.125,0.46875,0.203125],"q0":[-0.45,-0.6375,0.575],"q1":[0.45,-0.6375,0.575],"q3":[-0.45,0.0125,0.575],"normal":[0,0,1]}]}}}};
    // END GENERATED EQUIPMENT CARRIERS
    const equipmentOf = cfg => cfg.exportAsEquipment &&
        Object.prototype.hasOwnProperty.call(ANIMAL_EQUIPMENT, cfg.equipmentTarget)
        ? ANIMAL_EQUIPMENT[cfg.equipmentTarget] : null;
    const equipmentParts = cfg => EQUIPMENT_CARRIERS[cfg.equipmentTarget]?.bindings || {};
    const equipmentLabel = pair => pair[(typeof settings !== 'undefined' && settings.language?.value === 'ru') ? 1 : 0];
    function animalEquippable(equipment, asset, legacy = false) {
        if (legacy) return horseEquippable(equipment, asset);
        return JSON.stringify({...equipment.component, asset_id: `minecraft:${asset}`});
    }
    const EQUIPMENT_PART_LABELS = {
        right_front_leg: ['Right front leg','Правая передняя нога'], left_front_leg: ['Left front leg','Левая передняя нога'],
        right_hind_leg: ['Right hind leg','Правая задняя нога'], left_hind_leg: ['Left hind leg','Левая задняя нога'],
        right_leg: ['Right leg','Правая нога'], left_leg: ['Left leg','Левая нога'],
        upper_mouth: ['Upper mouth','Верх рта'], lower_mouth: ['Lower mouth','Низ рта'], inner_mouth: ['Inner mouth','Внутренняя часть рта'],
        body: ['Body', 'Корпус'], head: ['Head', 'Голова'], neck: ['Neck', 'Шея'],
        legs: ['All legs', 'Все ноги'],
        tail: ['Tail', 'Хвост'], upper_body: ['Upper body', 'Грудь'],
        wings: ['Both wings', 'Оба крыла'],
        chests: ['Both chests', 'Оба сундука'], left_chest: ['Left chest', 'Левый сундук'],
        right_chest: ['Right chest', 'Правый сундук'], harness: ['Harness', 'Упряжь'],
        left_ear: ['Left ear', 'Левое ухо'], right_ear: ['Right ear', 'Правое ухо'],
        reins: ['Reins (with rider)', 'Поводья — с наездником'],
        goggles: ['Goggles', 'Очки'], shell: ['Shell', 'Раковина'],
    };
    const validEquipmentPart = value => typeof value === 'string' && (value === '' ||
        Object.prototype.hasOwnProperty.call(EQUIPMENT_PART_LABELS, value));
    function collectEquipmentPartTags() {
        const map = {};
        if (typeof Group !== 'undefined') for (const g of Group.all || [])
            if (g?.uuid && g.objcubed_equipment_part && validEquipmentPart(g.objcubed_equipment_part))
                map[g.uuid] = g.objcubed_equipment_part;
        return map;
    }
    function applyEquipmentPartTags(map) {
        if (!map || typeof Group === 'undefined') return;
        for (const g of Group.all || []) if (g?.uuid && Object.prototype.hasOwnProperty.call(map, g.uuid)
            && validEquipmentPart(map[g.uuid])) g.objcubed_equipment_part = map[g.uuid];
    }
    // Assembled templates store their original rest axes separately from editable
    // Group.rotation. Removing CURRENT rotation would also erase artist changes.
    // The basis is column-major, in Blockbench world axes, and includes the native
    // uniform model scale (e.g. horse 1.1, happy ghast 4).
    const hasEquipmentRest = value => value && typeof value === 'object' && Object.keys(value).length > 0;
    function copyEquipmentRest(value) {
        return {...value, ...(Array.isArray(value.basis) ? {basis:value.basis.slice()} : {})};
    }
    function collectEquipmentRestTransforms() {
        const map = {};
        if (typeof Group !== 'undefined') for (const g of Group.all || [])
            if (g?.uuid && hasEquipmentRest(g.objcubed_equipment_rest))
                map[g.uuid] = copyEquipmentRest(g.objcubed_equipment_rest);
        return map;
    }
    function applyEquipmentRestTransforms(map) {
        if (!map || typeof Group === 'undefined') return;
        for (const g of Group.all || []) if (g?.uuid && Object.prototype.hasOwnProperty.call(map,g.uuid))
            g.objcubed_equipment_rest = hasEquipmentRest(map[g.uuid]) ? copyEquipmentRest(map[g.uuid]) : {};
    }
    function validateEquipmentRestBasis(basis) {
        const error = () => { throw new Error('Equipment template rest basis must be a finite rotation with positive uniform scale.'); };
        if (!Array.isArray(basis) || basis.length !== 9 || !basis.every(Number.isFinite)) return error();
        const cols = [basis.slice(0,3),basis.slice(3,6),basis.slice(6,9)];
        const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
        const lengths = cols.map(col=>Math.hypot(...col)), scale = lengths[0];
        if (!Number.isFinite(scale) || scale < 1e-7 || lengths.some(v=>Math.abs(v/scale-1)>1e-5)
            || Math.abs(dot(cols[0],cols[1])) > scale*scale*1e-5
            || Math.abs(dot(cols[0],cols[2])) > scale*scale*1e-5
            || Math.abs(dot(cols[1],cols[2])) > scale*scale*1e-5) return error();
        const [a,b,c] = cols;
        const determinant = a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1]);
        if (!Number.isFinite(determinant) || !(determinant > 0)) return error();
        return basis.slice();
    }
    function equipmentRestBasis(group,cfg,part) {
        const rest = group.objcubed_equipment_rest;
        if (!hasEquipmentRest(rest)) return null;
        if (rest.target !== cfg.equipmentTarget || rest.part !== part)
            throw new Error(`Equipment template rest transform for "${group.name || group.uuid}" belongs to ${rest.target}/${rest.part}, not ${cfg.equipmentTarget}/${part}. Use the matching template and equipment part.`);
        return validateEquipmentRestBasis(rest.basis);
    }
    function equipmentCarrierInRestBasis(carrier,basis) {
        if (!basis) return carrier; // Existing projects retain byte-identical descriptors.
        validateEquipmentRestBasis(basis);
        const transform = native => {
            // S * BB_rest * S, S=diag(1,-1,1): native ModelPart Y points down.
            const p = [native[0],-native[1],native[2]];
            return [basis[0]*p[0]+basis[3]*p[1]+basis[6]*p[2],
                -(basis[1]*p[0]+basis[4]*p[1]+basis[7]*p[2]),
                basis[2]*p[0]+basis[5]*p[1]+basis[8]*p[2]];
        };
        return {...carrier,quads:carrier.quads.map(q=>{
            const normal=transform(q.normal),length=Math.hypot(...normal);
            return {...q,q0:transform(q.q0),q1:transform(q.q1),q3:transform(q.q3),normal:normal.map(v=>v/length)};
        })};
    }
    function equipmentBindingOfElement(el, cfg) {
        const equipment = equipmentOf(cfg);
        if (!equipment) return null;
        for (let cur = el; cur && cur !== 'root' && typeof cur === 'object'; cur = cur.parent) {
            const part = cur.objcubed_equipment_part;
            if (!part) continue;
            if (!Object.prototype.hasOwnProperty.call(equipmentParts(cfg), part))
                throw new Error(`Equipment part "${part}" is not supported by ${cfg.equipmentTarget}. Choose a part listed in the export dialog.`);
            const origin = cur.origin;
            if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite))
                throw new Error(`Equipment group "${cur.name || cur.uuid}" needs a finite X/Y/Z origin.`);
            const restBasis = equipmentRestBasis(cur,cfg,part);
            return {part, pivot: origin.map(v => v / 16), key: cur.uuid || cur.name, explicit: true,
                ...(restBasis ? {restBasis} : {})};
        }
        return {part: equipment.defaultPart, pivot: [0,0,0], key: 'default', explicit: false};
    }
    function buildFaceEquipmentBindings(faceGroups, cfg) {
        if (!equipmentOf(cfg)) return null;
        const geo = typeof Outliner === 'undefined' ? [] : (Outliner.elements || []).filter(el =>
            (typeof Cube !== 'undefined' && el instanceof Cube) || (typeof Mesh !== 'undefined' && el instanceof Mesh));
        const bindings = faceGroups.map(name => {
            const match = /^ocp\d+e\d+i(\d+)$/.exec(name || '');
            // Token IDs are assigned independently of OBJ traversal order.
            const el = match ? geo[Number(match[1])] : geo.find(el => el.name === name);
            return equipmentBindingOfElement(el, cfg);
        });
        // Old horse models stay byte-for-byte v1 until explicitly tagged.
        return horseEquipmentOf(cfg) && !bindings.some(b => b.explicit) ? null : bindings;
    }
    function planAnimalLayers(result, cfg) {
        const equipment = equipmentOf(cfg);
        const bindings = result.faceToEquipmentBinding || Array.from({length: result.nfaces}, () =>
            ({part:equipment.defaultPart,pivot:[0,0,0],key:'default'}));
        if (bindings.length !== result.nfaces) throw new Error('Equipment binding count does not match faces.');
        const groups = new Map();
        for (let i=0;i<bindings.length;i++) {
            const b=bindings[i];
            if (!b || !Object.prototype.hasOwnProperty.call(equipmentParts(cfg),b.part))
                throw new Error(`Unsupported equipment binding: ${b?.part} for ${cfg.equipmentTarget}`);
            if (!Array.isArray(b.pivot) || b.pivot.length!==3 || !b.pivot.every(Number.isFinite))
                throw new Error('Equipment pivot must contain three finite coordinates.');
            if (b.restBasis) validateEquipmentRestBasis(b.restBasis);
            const key=JSON.stringify([b.key,b.part,b.pivot,b.restBasis]);
            if (!groups.has(key)) groups.set(key,{...b,faces:[]});
            groups.get(key).faces.push(i);
        }
        const layers=[];
        for (const b of groups.values()) {
            const carrier=equipmentParts(cfg)[b.part],capacity=carrier.quads.length;
            if (capacity<1 || capacity>6) throw new Error('Invalid native equipment carrier capacity.');
            for(let i=0;i<b.faces.length;i+=capacity)
                layers.push({...b,faces:b.faces.slice(i,i+capacity),carrier});
        }
        return layers;
    }
    function encodeAnimalLayer(result, cfg, layer, faceEmission) {
        const height=result.ty+Math.ceil(99/result.tw);
        if (result.ty>65535 || height>65535) throw new Error('Equipment texture exceeds 65535 rows.');
        const data=Buffer.alloc(result.tw*height*4);
        Buffer.from(result.rawBuf).copy(data);
        data[3]=252;
        for(let i=0;i<6;i++) {
            const index=layer.faces[i] ?? 65535, at=(8+i)*4;
            data[at]=index>>8;data[at+1]=index&255;
            data[at+2]=index===65535?0:Math.max(0,Math.min(15,faceEmission[index]|0));
            data[at+3]=i===0?2:0;
        }
        data.set([result.ty>>8,result.ty&255,6,0],14*4);
        data.set([79,67,50,1],15*4);
        let at=result.ty*result.tw*4;
        // Transform only active carrier descriptors. The shader reconstructs the
        // inverse rest basis from them, with no extra per-vertex/GPU work, while
        // the shared OBJ payload remains assembled for the ordinary item view.
        const carrier=equipmentCarrierInRestBasis(layer.carrier,layer.restBasis);
        if (carrier.quads.length<1 || carrier.quads.length>6 || layer.faces.length>carrier.quads.length)
            throw new Error('Invalid native equipment carrier capacity.');
        const floats=carrier.quads.flatMap(q=>[...q.uv,...q.q0,...q.q1,...q.q3,...q.normal]);
        while(floats.length<96) floats.push(0);
        const scale=Number.isFinite(cfg.scale)&&cfg.scale>0?cfg.scale:1;
        floats.push(layer.pivot[0]*scale,-layer.pivot[1]*scale,layer.pivot[2]*scale);
        if(floats.length!==99 || !floats.every(Number.isFinite)) throw new Error('Invalid native equipment carrier.');
        for(const value of floats) {data.writeFloatLE(value,at);at+=4;}
        return encodePNG(result.tw,height,data);
    }

    // Global UI-scale (issue #6). Stored in GLOBAL localStorage, NOT in the
    // per-project preset system — it's a viewer preference, not model data.
    // Intentionally absent from PERSISTABLE_FIELDS.
    // Issue #6: the export dialog renders at a fixed enlarged scale. The whole
    // stylesheet (and every inline font-size) reads var(--oc-scale); we pin that
    // var to UI_SCALE on .oc-root and the tooltip portal, so a future bump is a
    // one-line change. No per-user toggle — the smaller sizes weren't needed.
    const UI_SCALE = 1.25;
    // Version branch of the mcasset mirror (github.com/InventivetalentDev/
    // minecraft-assets) the base-item picker pulls the item registry + icons
    // from. Keep in step with the MC version the shaders target.
    const MC_ASSETS_VERSION = '26.3';

    // Guided tour (issue #4) — canonical step list (single source of truth).
    // The dialog closure derives its `tourSteps` from this; sel is the DOM
    // marker resolved at run time (null = centered card, '__export__' = the
    // native dialog-bar Export button). titleKey/bodyKey must exist in BOTH
    // LANG.en and LANG.ru (enforced by test/unit/tour-i18n.test.mjs).
    // Steps are ordered to match the dialog's visual top-to-bottom flow, so the
    // tour scrolls in one direction. requiresAnims drops a step when the model
    // has no animations; reveal turns a hidden section on before measuring so
    // its anchor exists (restored in tourEnd). One step per meaningful control.
    const TOUR_STEPS = [
        { sel: null,                      titleKey: 'tour_t_welcome',       bodyKey: 'tour_b_welcome'       },
        // ── Texture card ──
        { sel: '.oc-tour-texture',        titleKey: 'tour_t_texture',       bodyKey: 'tour_b_texture'       },
        // atlas toggle only renders for multi-texture models; positionTour()
        // centers the card harmlessly when the anchor is absent.
        { sel: '.oc-tour-atlas',          titleKey: 'tour_t_atlas',         bodyKey: 'tour_b_atlas'         },
        // ── Display card ──
        { sel: '.oc-display-tabs',        titleKey: 'tour_t_display',       bodyKey: 'tour_b_display'       },
        { sel: '.oc-tour-preview',        titleKey: 'tour_t_preview',       bodyKey: 'tour_b_preview'       },
        // third-person transform row is v-show-gated by displayTab; reveal opens it.
        { sel: '.oc-tour-thirdrow',       titleKey: 'tour_t_transform',     bodyKey: 'tour_b_transform',     reveal: { displayTab: 'third' } },
        // ── Behavior: animation block (all inside v-if="hasAnims && animationEnabled") ──
        { sel: '.oc-tour-animation',      titleKey: 'tour_t_animation',     bodyKey: 'tour_b_animation'     },
        { sel: '.oc-tour-animselect',     titleKey: 'tour_t_animselect',    bodyKey: 'tour_b_animselect',    requiresAnims: true, reveal: { animationEnabled: true } },
        { sel: '.oc-tour-fps',            titleKey: 'tour_t_fps',           bodyKey: 'tour_b_fps',           requiresAnims: true, reveal: { animationEnabled: true } },
        { sel: '.oc-tour-range',          titleKey: 'tour_t_range',         bodyKey: 'tour_b_range',         requiresAnims: true, reveal: { animationEnabled: true } },
        { sel: '.oc-tour-autoplay',       titleKey: 'tour_t_autoplay',      bodyKey: 'tour_b_autoplay',      requiresAnims: true, reveal: { animationEnabled: true } },
        // texAnim block only renders when a frame-strip texture is present;
        // positionTour() centers the card harmlessly when the anchor is absent.
        { sel: '.oc-tour-texanim',        titleKey: 'tour_t_texanim',       bodyKey: 'tour_b_texanim'       },
        { sel: '.oc-tour-easing',         titleKey: 'tour_t_easing',        bodyKey: 'tour_b_easing'        },
        { sel: '.oc-tour-autorotate',     titleKey: 'tour_t_autorotate',    bodyKey: 'tour_b_autorotate'    },
        { sel: '.oc-tour-datapack',       titleKey: 'tour_t_datapack',      bodyKey: 'tour_b_datapack',      requiresAnims: true, reveal: { animationEnabled: true } },
        // datapack fields live inside v-if="generateDatapack"; reveal both flags.
        { sel: '.oc-tour-datapackid',     titleKey: 'tour_t_datapackid',    bodyKey: 'tour_b_datapackid',    requiresAnims: true, reveal: { animationEnabled: true, generateDatapack: true } },
        { sel: '.oc-tour-datapacktarget', titleKey: 'tour_t_datapacktarget',bodyKey: 'tour_b_datapacktarget',requiresAnims: true, reveal: { animationEnabled: true, generateDatapack: true } },
        // ── Behavior: output sub-section ──
        { sel: '.oc-tour-respack',        titleKey: 'tour_t_respack',       bodyKey: 'tour_b_respack'       },
        { sel: '.oc-tour-baseitem',       titleKey: 'tour_t_baseitem',      bodyKey: 'tour_b_baseitem'      },
        { sel: '.oc-tour-cmdname',        titleKey: 'tour_t_cmdname',       bodyKey: 'tour_b_cmdname'       },
        { sel: '.oc-tour-equipment',      titleKey: 'tour_t_equipment',     bodyKey: 'tour_b_equipment'     },
        // equip slot select is v-if="exportAsEquipment"; reveal opens it.
        { sel: '.oc-tour-equipslot',      titleKey: 'tour_t_equipslot',     bodyKey: 'tour_b_equipslot',     reveal: { exportAsEquipment: true } },
        // ── Behavior: color & advanced ── (easing/autorotate steps moved up
        // to the animation group, matching their new position in the layout)
        { sel: '.oc-tour-color',          titleKey: 'tour_t_color',         bodyKey: 'tour_b_color'         },
        { sel: '.oc-tour-flags',          titleKey: 'tour_t_flags',         bodyKey: 'tour_b_flags'         },
        // sel: null → centred card (like the welcome step). The emissive toggle
        // lives in the OUTLINER right-click menu, not in this dialog, so there
        // is nothing to spotlight — but it has to be discoverable somewhere.
        { sel: null,                      titleKey: 'tour_t_emissive',      bodyKey: 'tour_b_emissive'      },
        { sel: '__export__',              titleKey: 'tour_t_export',        bodyKey: 'tour_b_export'        },
    ];
    // Flat list of every title/body key the tour references — used by the
    // i18n parity test to assert each exists in both dictionaries.
    const TOUR_STEP_KEYS = TOUR_STEPS.reduce((a, s) => { a.push(s.titleKey, s.bodyKey); return a; }, []);

    // =========================================================
    // Section 1.2: Internationalization
    // =========================================================
    const LANG = {
        en: {
            // Dialog
            dialog_title: 'Export obj³',
            btn_export: 'Export',
            btn_close: 'Close',
            export_failed: 'Export failed: ',
            export_done: "Exported. {info}",
            status_building: "Preparing export…",
            status_baking: "Exporting frame {i}/{n}…",
            status_choose_location: '{info} — choose save location…',
            status_cancelled: 'Export cancelled',
            color_datapack_note: "Set by the datapack",
            color_equipment_note: "RGB modes affect the item view.",
            no_project: 'No project is open.',
            no_textures: 'The project has no textures.',
            // Texture section
            section_texture: 'Texture',
            atlas_combine: 'Combine textures into atlas',
            // Transform section
            section_transform: "Model size and position",
            lbl_scale: 'Scale',
            lbl_offset_x: 'Offset X',
            lbl_offset_y: 'Offset Y',
            lbl_offset_z: 'Offset Z',
            // Behavior section (merged: transform + animation + color + advanced)
            section_behavior: "Export settings",
            // Animation section
            section_animation: 'Animation',
            no_animations: 'No animations in project',
            lbl_animation: 'Animation',
            lbl_fps: 'FPS',
            lbl_start: "Start (s)",
            lbl_end: 'End (s)',
            lbl_autoplay: 'Autoplay',
            lbl_duration: 'duration',
            // Datapack
            lbl_datapack: 'Control animation via datapack',

            lbl_anim_id: "Animation name",
            lbl_namespace: 'Namespace',
            lbl_target: "Target",
            lbl_slot: 'Slot',
            lbl_respack_dir: "Resource pack folder",
            lbl_output_mode: "Export as", output_pack: "Resource pack", output_files: "Model and texture",
            lbl_model_dir: "Model folder", lbl_texture_dir: "Texture folder", lbl_texture_resource: "Texture resource ID",
            lbl_contexts: "Display contexts", contexts_auto: "Automatic", contexts_selected: "Choose contexts",
            help_output_mode: "Model and texture saves model JSON and PNG files in separately chosen folders, without assets, item definitions or give commands. Place the files in your pack yourself. Equipment and datapacks require Resource pack mode.",
            help_texture_resource: "Texture reference in the model JSON, for example mypack:item/golem. No .png extension. Leave blank for objcubed:item/<model ID>.",
            help_contexts: "Default is always exported. Select extra variants for the contexts you need. Unselected contexts use default; this does not hide the model. Hands, ground and shelf need their variants for correct positioning. Existing files are not deleted.",
            err_files_options: "Equipment and datapacks require Resource pack mode.",
            err_texture_resource: "Use a texture ID such as mypack:item/golem, without .png or parent-directory segments.",
            lbl_base_item: 'Base item',
            lbl_cmd_name: "Model ID",
            lbl_export_equipment: "Export equipment",
            lbl_equipment_target: 'Equipment type',
            opt_humanoid: 'Player / armor stand',
            opt_horse_body: 'Horse armor',
            opt_horse_saddle: 'Horse saddle',

            animal_supported_parts: 'Available bindings',
            menu_equipment_part: 'obj³: Animal equipment part',

            lbl_equipment_layers: 'Equipment layers',
            lbl_equip_slot: 'Slot',
            lbl_equip_pieces: "Armor pieces",
            opt_piece_helmet: 'Helmet',
            opt_piece_chestplate: 'Chestplate',
            opt_piece_leggings: 'Leggings',
            opt_piece_boots: 'Boots',
            help_equip_pieces: "Select the armor pieces to export. Assign groups through right-click → obj³: Body part, or name them head, body, right_arm, etc. A chestplate includes the torso and both arms. Older projects with no pieces selected keep their saved single-part slot.",
            lbl_datapack_dir: 'Datapack output directory',
            tip_browse_folder: 'Choose folder',
            opt_equipment: "Mob equipment",
            opt_item_display: "Item display (item_display)",
            opt_player: "Player",
            opt_mainhand: 'Main hand',
            opt_offhand: 'Off hand',
            opt_head: 'Helmet',
            opt_chest: 'Chestplate',
            opt_legs: 'Leggings',
            opt_feet: 'Boots',
            opt_right_arm: 'Right arm',
            opt_left_arm: 'Left arm',
            opt_right_leg: 'Right leg',
            opt_left_leg: 'Left leg',
            opt_right_foot: 'Right foot',
            opt_left_foot: 'Left foot',
            placeholder_near_png: "Next to the resource pack",

            // Display section
            section_display: 'Display',
            tip_bb_display: "Adjust the item view in Blockbench.",
            tab_third: "Right hand · third person",
            tab_left: "Left hand · third person",
            tab_fpr: "Right hand · first person",
            tab_fpl: "Left hand · first person",
            tab_head: 'Head',
            tab_gui: 'Inventory',
            tab_ground: 'Ground',
            tab_fixed: 'Frame',
            tab_shelf: 'Shelf',
            lbl_rotation: 'Rotation',
            lbl_translation: 'Translation',
            lbl_display_scale: 'Scale',
            lbl_gui_pivot: "Icon rotation centre",
            help_guiPivot: "Rotation centre of the inventory icon, in 1/16-block units. 0/0/0 is the block centre. It does not affect other views.",
            columns_xyz: 'Columns are X, Y, Z.',
            ground_y_tip: "Minecraft limits the height of dropped items.",
            preview_title: "Preview",
            open_display_editor: "Edit in BlockBench",

            open_display_disabled: "This model format has no display editor.",
            lbl_export_cameras: 'Export Cameras',
            help_exportCameras: 'Camera position and direction, including parent animation. Requires an item_display datapack. Uses the Fixed display view and one exported frame per tick. FOV and roll are not supported. Viewing temporarily uses spectator mode; exit restores the player.',
            err_camera_target: 'Camera export requires an animated item_display datapack, without equipment export.',
            err_no_cameras: 'No exportable Cameras elements found in the project.',
            err_camera_names: 'Camera names must remain unique after conversion to lowercase English file names.',
            warn_camera_channels: 'Camera FOV and roll are not exported. Position and viewing direction are preserved.',
            help_displayPreview: "Open the selected view in Blockbench using these settings. This dialog closes. After editing, reopen Export obj³ to import the changes and export them.",
            // Color & Tinting
            section_color: "Color controls",
            cb_direct: "Tint",
            cb_time: "Animation",
            cb_scale: 'Scale',
            cb_overlay: 'Overlay',
            cb_hurt: "Flash",
            color_all_direct: "Potion color tints the model.",
            color_all_time: "Potion color selects the animation frame.",
            color_all_scale: "Potion color changes the model size.",
            color_all_overlay: "Potion color changes the model hue.",
            color_all_hurt: "Potion color controls the red flash.",
            // Advanced
            section_advanced: 'Advanced',
            lbl_easing: "Frame transitions",
            lbl_autorotate: 'Autorotate',
            opt_none: 'None (hold)',
            opt_linear: 'Linear',
            opt_cubic: 'Cubic (in-out)',
            opt_bezier: 'Catmull-Rom',
            opt_easein: 'Ease in',
            opt_easeout: 'Ease out',
            opt_off: 'Off',
            opt_horizontal: 'Horizontal',
            opt_vertical: 'Vertical',
            opt_both: 'Both',
            lbl_noshadow: "Glow entire model",
            lbl_flipuv: "Flip texture vertically",
            lbl_nopow: "Keep PNG height",
            lbl_filter_armature: "Exclude armature bones",
            // Footer / status
            status_display_mode: "After editing, reopen File → Export obj³.",
            status_display_unavailable: 'Display mode is not available for this model format',
            // Validation
            err_fps_min: "Enter at least 1 FPS.",
            err_fps_max: "Enter no more than 60 FPS.",
            err_end_before_start: "End must be later than start.",
            err_need_anim_id: "Enter an animation name.",
            err_need_namespace: "Enter a namespace.",
            err_atlas_none: 'Select at least one texture for atlas',
            // Preview warnings
            warn_model_empty: "There are no faces to export.",
            warn_too_many_faces: "The model has {n} faces. Reduce detail or frame count if the game slows down or fails to load it.",
            warn_tex_wide: "The texture is {w}px wide. Check the exported model in game; reduce the width if it does not appear.",
            warn_tex_narrow: "The texture is {w}px wide. Use a width of at least 8px to export.",
            warn_filter_no_armature: "There are no armature bones to exclude.",
            warn_atlas_empty: "Select textures for the atlas.",
            warn_tex_strip_ratio: "Texture {w}×{h} has an invalid frame size. Set a whole-pixel frame size in Blockbench.",
            // Size units
            unit_b: 'B',
            unit_kb: 'KB',
            unit_mb: 'MB',
            // Outliner right-click menus
            menu_toggle_emissive: 'obj³: Toggle Emissive',
            menu_body_part: 'obj³: Body part',
            bp_none: '— None —',
            bp_head: 'Head',
            bp_body: 'Body / Chest',
            bp_waist: 'Waist (leggings)',
            bp_arm_r: 'Right arm',
            bp_arm_l: 'Left arm',
            bp_leg_r: 'Right leg',
            bp_leg_l: 'Left leg',
            bp_foot_r: 'Right foot / boot',
            bp_foot_l: 'Left foot / boot',
            toast_emissive_on: "Glow enabled",
            toast_emissive_off: "Glow disabled",
            toast_bodypart: 'obj³: {name} → {part}',
            undo_emissive_on: 'Enable emissive',
            undo_emissive_off: 'Disable emissive',
            undo_bodypart: 'Set obj³ body part',
            // Frame count
            frames_one: 'frame',
            frames_other: 'frames',
            ticks_one: 'tick',
            ticks_other: 'ticks',
            problems_one: 'problem',
            problems_other: 'problems',
            faces_one: 'face',
            faces_other: 'faces',
            warnings_one: 'warning',
            warnings_other: 'warnings',
            warn_suffix: ' ({n} {w} — see console)',
            // Help tooltips
            help_selectedTex: "Choose the texture used by the model. For several textures, enable the atlas.",
            help_useAtlas: "Export several textures together. Select the textures used by the model. Up to four animated textures can share an atlas; with narrow textures, fewer may fit. The exporter warns if some will remain static.",
            tex_anim_enable: 'Animate texture',
            tex_frametime: 'Ticks per frame',
            tex_chip_each: "per frame",
            tex_fade: "Blend texture frames",
            help_texAnim: "Play texture frames in game. Map UVs to one frame. Blockbench frame sizes are supported; without frame metadata, use a vertical strip of square frames. Animated atlas textures share frame duration and blending settings.",
            help_texFrametime: "How long each texture frame stays visible. 20 ticks = 1 second; a larger value plays the texture more slowly.",
            help_texFade: "Blend into the next texture frame instead of switching abruptly. Some world views may still switch frames without blending.",
            help_scale: "Change the size of the whole model. 1 keeps its original size; 2 doubles it. Display tab scale applies as well.",
            help_offset: "Move the whole model along X, Y and Z before applying display settings.",
            help_animationEnabled: "Export the selected Blockbench animation. When disabled, export the current pose only.",
            help_animationIndex: "Choose the animation to export. Export other animations separately.",
            help_animFps: "Frames saved per second of the source animation. A higher value preserves more motion detail and increases file size. This is not game FPS and does not change the animation duration.",
            help_animRange: "Export a time range in seconds. Use 0 and the animation length to export the entire animation.",
            help_duration: "Length of one playback cycle in ticks. 20 ticks = 1 second. The export dialog uses the selected animation range.",
            help_autoplay: "Loop the animation automatically. Datapack control disables this setting; start playback with its commands.",
            help_generateDatapack: "Create animation commands. Put the generated objcubed folder in the world’s datapacks folder and run /reload. The datapack README.txt lists its commands. Datapack settings control playback and override RGB modes.",
            help_datapackAnimId: "Name used in animation commands. Use a–z, 0–9 and underscores, up to 12 characters. Choose a different name for each animation.",
            help_datapackNamespace: "First part of the function name: function <namespace>:<animation>/play. Use a–z, 0–9 and underscores.",
            help_datapackTargetType: "Choose who uses the animated model: a mob, an item_display entity or a player. For a player, the datapack temporarily creates an armor stand to update playback; it removes the stand afterwards.",
            help_datapackEquipSlot: "Choose the slot containing the animated item. It must match where the target wears or holds it.",
            help_respack_dir: "Choose the resource pack folder. The model and texture are saved inside it; you can use an existing pack or a new folder.",
            help_base_item: "Minecraft item used to give this model, for example iron_ingot. Different model IDs can use the same item.",
            help_cmd_name: "Unique model name used in the give command. Defaults to the project name. Commands are added to <item>_give.txt; existing commands are kept.",
            help_equipment: "Export wearable armor, saddles, harnesses, decorations or elytra. Choose the type below. Item views in the hand and inventory are exported too.",
            help_datapackOutputDir: "Folder for the generated datapack. Leave empty to save it next to the resource pack.",
            help_display_third: "Position, rotation and size in another player’s hand. Right and left hands have separate settings.",
            help_display_head: "Position, rotation and size when worn on the head.",
            help_display_ground: "Position, rotation and size of a dropped item. Minecraft limits its height above the ground.",
            help_display_fixed: "Position, rotation and size in an item frame.",
            help_cb_general: "Click R, G or B to choose what that potion color channel controls: tint, animation frame, hue or a red flash. Modes on different channels combine. On worn equipment, dye color controls playback instead; these modes affect only its item view.",
            help_easing: "Choose how the model moves between saved frames. None switches frames directly; Linear moves evenly; Cubic eases both ends; Catmull-Rom uses neighbouring frames; Ease in accelerates and Ease out slows down.",
            help_autorotate: "Make the model follow horizontal rotation, vertical rotation or both. Both is suitable for most models. Explicit display settings take precedence in world views.",
            help_noshadow: "Keep the entire model bright in the dark. To make only selected cubes or meshes glow, use right-click → obj³: Toggle Emissive instead. Neither option lights the surroundings.",
            help_flipuv: "Flip the texture from top to bottom. Use if it appears upside down in game.",
            help_nopow: "Save without increasing the PNG height to the next power of two. This can reduce file size; check the result in game.",
            help_filterArmature: "Exclude the armature’s diamond-shaped bone guides. The model itself is still exported.",
            help_animalBindings: "Assign groups through right-click → obj³: Animal equipment part. The group origin is its attachment point. Untagged geometry uses the main binding. Legs and wings repeat one detail. Camel reins appear only with a rider; ear groups move independently. Templates already have their bindings and origins set.",
            help_equipmentLayers: "Each group is packed separately, up to six faces per layer; camel reins fit two. More groups, faces and frames increase rendering cost. The layer estimate is a minimum.",
            help_animalDatapack: "The equipment type sets the target and slot automatically. Run animation functions as the wearer. summon creates the chosen mob; elytra functions run as the player.",
            help_datapackCommands: "init prepares playback; play loops; stop stops; set selects a frame; play_from starts at a chosen frame; play_once plays once. Run functions as the target. Exact commands are in the generated README.txt.",
            lbl_datapack_commands: "Commands",
            help_display: "Adjust position, rotation and size for each view. Columns are X, Y and Z. Right and left hands are independent.",
            // Guided tour (issue #4)
            tour_btn: "Guide",
            tour_next: 'Next',
            tour_back: 'Back',
            tour_skip: 'Skip',
            tour_done: 'Done',
            tour_step: '{i} / {n}',
            tour_t_welcome: "Export with obj³",
            tour_b_welcome: "Export models and animations to a Minecraft resource pack. Set the texture, item views and output folder, then export. This guide walks through those settings.",
            tour_t_texture: 'Texture',
            tour_b_texture: "Choose the texture used by the model. The thumbnail shows your current selection. For several textures, use the atlas option.",
            tour_t_atlas: 'Combine into atlas',
            tour_b_atlas: "Enable this to export several textures together. Select all textures used by the model; otherwise choose a single texture from the list.",
            tour_t_texanim: 'Animated texture',
            tour_b_texanim: "Enable texture playback in game. Set how long each frame stays visible and whether frames blend into each other. Animated textures also work in an atlas.",
            tour_t_display: 'Display slots',
            tour_b_display: "Choose where the item is shown: in a hand, on the head, in the inventory, on the ground, in a frame or on a shelf. Each view has its own settings, including each hand.",
            tour_t_preview: 'Open in Blockbench',
            tour_b_preview: "Open the selected view in Blockbench to check the model. This dialog will close. After editing, reopen Export obj³ to use the changes for export.",
            tour_t_transform: 'Position, rotation, scale',
            tour_b_transform: "Set rotation, position and size along X, Y and Z for this view. Type values or drag the fields sideways. Use Preview in Blockbench to check the result.",
            tour_t_animation: 'Animation',
            tour_b_animation: "Enable this to export a Blockbench animation. Choose an animation and time range below. With animation disabled, only the current pose is exported.",
            tour_t_animselect: 'Animation clip',
            tour_b_animselect: "Choose one animation from the project. Other animations can be exported separately under different model IDs.",
            tour_t_fps: "Animation FPS",
            tour_b_fps: "Set how many frames to save per second of animation. Higher values preserve more motion detail and make the file larger. Animation duration stays the same.",
            tour_t_range: "Start / End",
            tour_b_range: "Set the start and end of the exported range in seconds. To export the whole animation, use 0 and its full length.",
            tour_t_autoplay: 'Autoplay',
            tour_b_autoplay: "Loop the animation automatically. For command control, enable the datapack instead; its settings take over playback.",
            tour_t_color: 'Color behaviors',
            tour_b_color: "Click R, G or B to choose tint, animation, hue or a red flash for that potion color channel. Different channel modes combine. Worn equipment uses separate playback controls.",
            tour_t_datapack: 'Datapack control',
            tour_b_datapack: "Create commands to start, stop or select frames of the animation. Install the generated folder in the world’s datapacks folder and run /reload. Its README.txt lists the commands.",
            tour_t_datapackid: "Animation name and namespace",
            tour_b_datapackid: "Choose an animation name and namespace for its commands. Use different names for different animations so exports do not overwrite one another.",
            tour_t_datapacktarget: 'Datapack target & slot',
            tour_b_datapacktarget: "Choose the wearer or display entity and the slot holding the animated item. For animal equipment and elytra, the selected equipment type sets these automatically.",
            tour_t_equipment: 'Equipment / armor',
            tour_b_equipment: "Enable this for armor, saddles, harnesses, decorations or elytra. Choose the equipment type; animal equipment lists its available bindings below.",
            tour_t_equipslot: 'Armor pieces',
            tour_b_equipslot: "Choose the armor pieces to export. Assign the relevant groups through right-click → obj³: Body part. For animal equipment, use its listed bindings instead.",
            tour_t_respack: 'Resource-pack folder',
            tour_b_respack: "Choose the resource pack folder where the model should be saved. Use the folder button to browse. The model’s give command is saved there too.",
            tour_t_baseitem: 'Base item',
            tour_b_baseitem: "Choose the Minecraft item to give with this model, for example iron_ingot. Several models can share an item if each has a different model ID.",
            tour_t_cmdname: 'Model name',
            tour_b_cmdname: "Choose a unique model ID. The give command uses this name and is saved in the resource pack. Existing give commands are kept when you export again.",
            tour_t_easing: "Frame transitions",
            tour_b_easing: "Choose how movement changes between saved frames. None shows the frames without transitions; the other modes smooth the movement between them.",
            tour_t_autorotate: 'Autorotate',
            tour_b_autorotate: "Choose whether the model follows horizontal rotation, vertical rotation or both. Both is the default. Display settings can also set the model’s orientation.",
            tour_t_flags: "Additional settings",
            tour_b_flags: "Glow entire model keeps all its parts bright in the dark. Flip texture turns it upside down. Keep PNG height can reduce file size. Details for each setting are under ?.",
            tour_t_emissive: 'Glowing cubes',
            tour_b_emissive: "To keep a cube or mesh bright in the dark, right-click it in the Outliner and enable obj³: Toggle Emissive. Only the selected elements glow; they do not light their surroundings.",
            tour_t_export: 'Export',
            tour_b_export: "Export when the settings are ready. Files and give commands are saved in the chosen resource pack. Enable the pack in Minecraft and use the saved give command.",
        },
        ru: {
            dialog_title: 'Экспорт obj³',
            btn_export: 'Экспортировать',
            btn_close: 'Закрыть',
            export_failed: 'Экспорт не удался: ',
            export_done: "Экспорт завершён. {info}",
            status_building: "Подготовка экспорта…",
            status_baking: "Экспорт кадра {i}/{n}…",
            status_choose_location: '{info} — выберите место сохранения…',
            status_cancelled: 'Экспорт отменён',
            color_datapack_note: "Задаётся датапаком",
            color_equipment_note: "Режимы RGB влияют на вид предмета.",
            no_project: 'Нет открытого проекта.',
            no_textures: 'В проекте нет текстур.',
            section_texture: 'Текстура',
            atlas_combine: 'Объединить текстуры в атлас',
            section_transform: "Размер и положение модели",
            lbl_scale: 'Масштаб',
            lbl_offset_x: 'Сдвиг X',
            lbl_offset_y: 'Сдвиг Y',
            lbl_offset_z: 'Сдвиг Z',
            section_behavior: "Настройки экспорта",
            section_animation: 'Анимация',
            no_animations: 'В проекте нет анимаций',
            lbl_animation: 'Анимация',
            lbl_fps: 'FPS',
            lbl_start: "Начало (с)",
            lbl_end: 'Конец (с)',
            lbl_autoplay: 'Автозапуск',
            lbl_duration: 'длительность',
            lbl_datapack: 'Управлять анимацией через датапак',

            lbl_anim_id: "Имя анимации",
            lbl_namespace: 'Пространство имён',
            lbl_target: "Цель",
            lbl_slot: 'Слот',
            lbl_respack_dir: "Папка ресурспака",
            lbl_output_mode: "Экспортировать как", output_pack: "Ресурспак", output_files: "Модель и текстура",
            lbl_model_dir: "Папка модели", lbl_texture_dir: "Папка текстуры", lbl_texture_resource: "ID текстуры",
            lbl_contexts: "Контексты отображения", contexts_auto: "Автоматически", contexts_selected: "Выбрать контексты",
            help_output_mode: "Модель и текстура сохраняет JSON моделей и PNG в отдельно выбранные папки, без assets, описания предмета и команд выдачи. Разместите файлы в своём паке самостоятельно. Экипировка и датапаки требуют режима «Ресурспак».",
            help_texture_resource: "Ссылка на текстуру в JSON модели, например mypack:item/golem. Без расширения .png. Пустое поле использует objcubed:item/<ID модели>.",
            help_contexts: "Default экспортируется всегда. Отметьте дополнительные варианты для нужных контекстов. Остальные используют default; модель в них не скрывается. Для правильного отображения в руках, на земле и на полке нужны их варианты. Ранее созданные файлы не удаляются.",
            err_files_options: "Для экипировки и датапаков выберите режим «Ресурспак».",
            err_texture_resource: "Укажите ID текстуры вида mypack:item/golem, без .png и переходов к родительской папке.",
            lbl_base_item: 'Базовый предмет',
            lbl_cmd_name: "ID модели",
            lbl_export_equipment: "Экспортировать экипировку",
            lbl_equipment_target: 'Тип экипировки',
            opt_humanoid: 'Игрок / стойка для брони',
            opt_horse_body: 'Конская броня',
            opt_horse_saddle: 'Седло лошади',

            animal_supported_parts: 'Доступные привязки',
            menu_equipment_part: 'obj³: Часть экипировки моба',

            lbl_equipment_layers: 'Слоёв экипировки',
            lbl_equip_slot: 'Слот',
            lbl_equip_pieces: "Части брони",
            opt_piece_helmet: 'Шлем',
            opt_piece_chestplate: 'Нагрудник',
            opt_piece_leggings: 'Поножи',
            opt_piece_boots: 'Ботинки',
            help_equip_pieces: "Выберите части брони для экспорта. Назначьте группы через ПКМ → obj³: Часть тела или назовите их head, body, right_arm и т. п. Нагрудник включает корпус и обе руки. В старых проектах без выбранных частей сохраняется прежний слот одной части.",
            lbl_datapack_dir: 'Куда сохранить датапак',
            tip_browse_folder: 'Выбрать папку',
            opt_equipment: "Экипировка моба",
            opt_item_display: "Отображение предмета (item_display)",
            opt_player: "Игрок",
            opt_mainhand: 'Главная рука',
            opt_offhand: 'Вторая рука',
            opt_head: 'Шлем',
            opt_chest: 'Нагрудник',
            opt_legs: 'Поножи',
            opt_feet: 'Ботинки',
            opt_right_arm: 'Правая рука',
            opt_left_arm: 'Левая рука',
            opt_right_leg: 'Правая нога',
            opt_left_leg: 'Левая нога',
            opt_right_foot: 'Правая ступня',
            opt_left_foot: 'Левая ступня',
            placeholder_near_png: "Рядом с ресурспаком",

            section_display: 'Отображение',
            tip_bb_display: "Настройте вид предмета в Blockbench.",
            tab_third: "Правая рука · 3-е лицо",
            tab_left: "Левая рука · 3-е лицо",
            tab_fpr: "Правая рука · 1-е лицо",
            tab_fpl: "Левая рука · 1-е лицо",
            tab_head: 'Голова',
            tab_gui: 'Инвентарь',
            tab_ground: 'Земля',
            tab_fixed: 'Рамка',
            tab_shelf: 'Полка',
            lbl_rotation: 'Поворот',
            lbl_translation: 'Сдвиг',
            lbl_display_scale: 'Масштаб',
            lbl_gui_pivot: "Центр вращения иконки",
            help_guiPivot: "Центр вращения иконки в инвентаре, в единицах 1/16 блока. 0/0/0 — центр блока. На другие виды отображения не влияет.",
            columns_xyz: 'Колонки — X, Y, Z.',
            ground_y_tip: "Minecraft ограничивает высоту выпавших предметов.",
            preview_title: "Предпросмотр",
            open_display_editor: "Редактировать в BlockBench",

            open_display_disabled: "В этом формате модели нет редактора отображения.",
            lbl_export_cameras: 'Экспорт камер Cameras',
            help_exportCameras: 'Положение и направление камер, включая анимацию родителей. Нужен датапак для item_display. Используется вид «Рамка» и один экспортированный кадр за тик. FOV и крен не поддерживаются. Просмотр временно включает наблюдателя; выход восстанавливает игрока.',
            err_camera_target: 'Для камер нужен экспорт анимации с датапаком для item_display, без экспорта экипировки.',
            err_no_cameras: 'В проекте нет камер Cameras с включённым экспортом.',
            err_camera_names: 'Имена камер должны оставаться уникальными после преобразования в английские имена файлов нижнего регистра.',
            warn_camera_channels: 'FOV и крен камеры не экспортируются. Положение и направление взгляда сохраняются.',
            help_displayPreview: "Открытие выбранного вида в Blockbench с этими настройками. Это окно закроется. После правок снова откройте Экспорт obj³: изменения загрузятся в окно и попадут в экспорт.",
            section_color: "Управление цветом",
            cb_direct: "Окраска",
            cb_time: "Анимация",
            cb_scale: 'Масштаб',
            cb_overlay: 'Оттенок',
            cb_hurt: "Вспышка",
            color_all_direct: "Цвет зелья окрашивает модель.",
            color_all_time: "Цвет зелья выбирает кадр анимации.",
            color_all_scale: "Цвет зелья меняет размер модели.",
            color_all_overlay: "Цвет зелья меняет оттенок модели.",
            color_all_hurt: "Цвет зелья управляет красной вспышкой.",
            section_advanced: 'Дополнительно',
            lbl_easing: "Переходы кадров",
            lbl_autorotate: 'Автоповорот',
            opt_none: 'Нет (удержание)',
            opt_linear: 'Линейная',
            opt_cubic: 'Кубическая',
            opt_bezier: 'Catmull-Rom',
            opt_easein: 'Ускорение',
            opt_easeout: 'Замедление',
            opt_off: 'Выкл',
            opt_horizontal: 'По горизонтали',
            opt_vertical: 'По вертикали',
            opt_both: 'Оба',
            lbl_noshadow: "Свечение всей модели",
            lbl_flipuv: "Перевернуть текстуру",
            lbl_nopow: "Сохранить высоту PNG",
            lbl_filter_armature: "Не экспортировать кости",
            status_display_mode: "После правок снова откройте Файл → Экспорт obj³.",
            status_display_unavailable: 'Режим отображения недоступен в этом формате модели',
            err_fps_min: "Укажите не менее 1 кадра/с.",
            err_fps_max: "Укажите не более 60 кадров/с.",
            err_end_before_start: "Конец должен быть позже начала.",
            err_need_anim_id: "Укажите имя анимации.",
            err_need_namespace: "Укажите пространство имён.",
            err_atlas_none: 'Выберите хотя бы одну текстуру для атласа',
            warn_model_empty: "Нет граней для экспорта.",
            warn_too_many_faces: "В модели {n} граней. Уменьшите детализацию или число кадров, если модель снижает FPS или не загружается.",
            warn_tex_wide: "Ширина текстуры — {w} пикселей. Проверьте модель в игре; уменьшите ширину, если она не отображается.",
            warn_tex_narrow: "Ширина текстуры — {w} пикселей. Для экспорта нужна ширина не менее 8.",
            warn_filter_no_armature: "В проекте нет костей для исключения из экспорта.",
            warn_atlas_empty: "Выберите текстуры для атласа.",
            warn_tex_strip_ratio: "У текстуры {w}×{h} неверный размер кадра. Укажите целый размер кадра в пикселях в Blockbench.",
            unit_b: 'Б',
            unit_kb: 'КБ',
            unit_mb: 'МБ',
            // Outliner right-click menus
            menu_toggle_emissive: 'obj³: Переключить свечение',
            menu_body_part: 'obj³: Часть тела',
            bp_none: '— Нет —',
            bp_head: 'Голова',
            bp_body: 'Тело / Грудь',
            bp_waist: 'Пояс (поножи)',
            bp_arm_r: 'Правая рука',
            bp_arm_l: 'Левая рука',
            bp_leg_r: 'Правая нога',
            bp_leg_l: 'Левая нога',
            bp_foot_r: 'Правая ступня / ботинок',
            bp_foot_l: 'Левая ступня / ботинок',
            toast_emissive_on: "Свечение включено",
            toast_emissive_off: "Свечение выключено",
            toast_bodypart: 'obj³: {name} → {part}',
            undo_emissive_on: 'Включить свечение',
            undo_emissive_off: 'Выключить свечение',
            undo_bodypart: 'Задать часть тела obj³',
            frames_one: 'кадр',
            frames_few: 'кадра',
            frames_many: 'кадров',
            ticks_one: 'тик',
            ticks_few: 'тика',
            ticks_many: 'тиков',
            problems_one: 'проблема',
            problems_few: 'проблемы',
            problems_many: 'проблем',
            faces_one: 'грань',
            faces_few: 'грани',
            faces_many: 'граней',
            warnings_one: 'предупреждение',
            warnings_few: 'предупреждения',
            warnings_many: 'предупреждений',
            warn_suffix: ' ({n} {w} — см. консоль)',
            help_selectedTex: "Выберите текстуру модели. Если их несколько, включите атлас.",
            help_useAtlas: "Экспорт нескольких текстур вместе. Отметьте текстуры, которые использует модель. В атласе могут анимироваться до четырёх текстур; при небольшой ширине их может быть меньше. Плагин предупредит, если часть останется статичной.",
            tex_anim_enable: 'Анимировать текстуру',
            tex_frametime: 'Тиков на кадр',
            tex_chip_each: "на кадр",
            tex_fade: "Плавная смена кадров",
            help_texAnim: "Воспроизведение кадров текстуры в игре. Разверните UV на один кадр. Поддерживается размер кадра из Blockbench; без этих настроек используйте вертикальную полосу квадратных кадров. У текстур в атласе общие длительность кадра и плавность перехода.",
            help_texFrametime: "Время показа одного кадра текстуры. 20 тиков = 1 секунда; большее значение замедляет анимацию текстуры.",
            help_texFade: "Плавная смена одного кадра текстуры другим. В некоторых видах отображения в мире смена кадров может оставаться резкой.",
            help_scale: "Изменение размера всей модели. 1 — исходный размер, 2 — вдвое больше. Масштаб во вкладках отображения применяется дополнительно.",
            help_offset: "Сдвиг всей модели по X, Y и Z до применения настроек отображения.",
            help_animationEnabled: "Экспорт выбранной анимации Blockbench. Если выключено, экспортируется только текущая поза.",
            help_animationIndex: "Выберите анимацию для экспорта. Другие анимации экспортируйте отдельно.",
            help_animFps: "Число сохраняемых кадров на секунду исходной анимации. Больше кадров — подробнее движение и больше файл. Это не FPS игры; длительность анимации не меняется.",
            help_animRange: "Экспорт отрезка анимации в секундах. Для всей анимации укажите 0 и её полную длину.",
            help_duration: "Длительность одного цикла в тиках. 20 тиков = 1 секунда. В окне экспорта она определяется выбранным отрезком анимации.",
            help_autoplay: "Автоматическое повторение анимации. При управлении датапаком настройка отключена; воспроизведение запускается командами.",
            help_generateDatapack: "Создание команд управления анимацией. Поместите созданную папку objcubed в datapacks мира и выполните /reload. Команды перечислены в README.txt датапака. Настройки датапака управляют воспроизведением и заменяют выбранные режимы RGB.",
            help_datapackAnimId: "Имя в командах анимации. Используйте a–z, 0–9 и подчёркивания, до 12 символов. Для каждой анимации задавайте отдельное имя.",
            help_datapackNamespace: "Первая часть имени функции: function <пространство>:<анимация>/play. Используйте a–z, 0–9 и подчёркивания.",
            help_datapackTargetType: "Выберите, кто использует модель: моб, сущность item_display или игрок. Для игрока датапак временно создаёт стойку для брони, чтобы обновить воспроизведение, и затем удаляет её.",
            help_datapackEquipSlot: "Слот с анимированным предметом. Он должен совпадать со слотом, где цель носит или держит предмет.",
            help_respack_dir: "Выберите папку ресурспака. Модель и текстура сохранятся внутри неё; можно использовать существующий пакет или новую папку.",
            help_base_item: "Предмет Minecraft для выдачи модели, например iron_ingot. На одном предмете можно использовать несколько моделей с разными ID.",
            help_cmd_name: "Уникальное имя модели в команде выдачи. По умолчанию используется имя проекта. Команды добавляются в <предмет>_give.txt; прежние команды сохраняются.",
            help_equipment: "Экспорт носимой брони, сёдел, упряжи, попон или элитр. Выберите тип ниже. Вид предмета в руке и инвентаре также экспортируется.",
            help_datapackOutputDir: "Папка для созданного датапака. Если не заполнено, он сохранится рядом с ресурспаком.",
            help_display_third: "Положение, поворот и размер в руке другого игрока. Правая и левая руки настраиваются отдельно.",
            help_display_head: "Положение, поворот и размер предмета на голове.",
            help_display_ground: "Положение, поворот и размер выпавшего предмета. Minecraft ограничивает его высоту над землёй.",
            help_display_fixed: "Положение, поворот и размер в рамке.",
            help_cb_general: "Нажмите R, G или B, чтобы выбрать действие канала цвета зелья: окраска, кадр анимации, оттенок или красная вспышка. Режимы разных каналов сочетаются. У надетой экипировки цвет красителя управляет воспроизведением; эти режимы меняют только вид предмета.",
            help_easing: "Переходы между сохранёнными кадрами. «Нет» переключает их сразу; «Линейная» даёт равномерное движение; «Кубическая» сглаживает начало и конец; Catmull-Rom учитывает соседние кадры; «Ускорение» начинает медленно, «Замедление» заканчивает медленно.",
            help_autorotate: "Поворот модели по горизонтали, вертикали или обеим осям. «Оба» подходит для большинства моделей. Заданные настройки отображения имеют приоритет при показе в мире.",
            help_noshadow: "Вся модель остаётся яркой в темноте. Для свечения отдельных кубов или мешей используйте ПКМ → obj³: Переключить свечение. Оба варианта не освещают окружающий мир.",
            help_flipuv: "Переворот текстуры сверху вниз. Включите, если в игре текстура отображается вверх ногами.",
            help_nopow: "Сохранение без увеличения высоты PNG до ближайшей степени двойки. Это может уменьшить файл; проверьте результат в игре.",
            help_filterArmature: "Исключение ромбов, которыми показаны кости арматуры. Сама модель экспортируется.",
            // Гид по интерфейсу (issue #4)
            help_animalBindings: "Назначьте группы через ПКМ → obj³: Часть экипировки моба. Центр группы — точка крепления. Без метки используется основная привязка. Ноги и крылья повторяют одну деталь. Поводья верблюдов видны только с наездником; уши двигаются отдельно. В шаблонах привязки и центры групп уже настроены.",
            help_equipmentLayers: "Каждая группа экспортируется отдельно: до шести граней на слой, у поводьев верблюда — две. Больше групп, граней и кадров увеличивает нагрузку. Оценка числа слоёв — минимальная.",
            help_animalDatapack: "Тип экипировки автоматически задаёт цель и слот. Запускайте функции анимации от имени носителя. summon создаёт выбранного моба; функции элитр выполняются от имени игрока.",
            help_datapackCommands: "init подготавливает воспроизведение; play запускает цикл; stop останавливает; set выбирает кадр; play_from запускает с выбранного кадра; play_once проигрывает один раз. Выполняйте функции от имени цели. Точные команды — в созданном README.txt.",
            lbl_datapack_commands: "Команды",
            help_display: "Настройте положение, поворот и размер для каждого вида. Столбцы — X, Y и Z. Правая и левая руки настраиваются независимо.",
            tour_btn: "Обучение",
            tour_next: 'Далее',
            tour_back: 'Назад',
            tour_skip: 'Пропустить',
            tour_done: 'Готово',
            tour_step: '{i} / {n}',
            tour_t_welcome: "Экспорт с obj³",
            tour_b_welcome: "Экспорт моделей и анимаций в ресурспак Minecraft. Выберите текстуру, настройте вид предмета и папку сохранения. Обучение проведёт по этим настройкам.",
            tour_t_texture: 'Текстура',
            tour_b_texture: "Выберите текстуру модели. Миниатюра показывает выбранное изображение. Если модель использует несколько текстур, включите атлас.",
            tour_t_atlas: 'Объединить в атлас',
            tour_b_atlas: "Включите атлас для экспорта нескольких текстур вместе. Отметьте все текстуры модели. Если нужна только одна, выберите её из списка.",
            tour_t_texanim: 'Анимированная текстура',
            tour_b_texanim: "Включите воспроизведение текстуры в игре. Укажите время показа кадра и при необходимости плавную смену кадров. Анимированные текстуры работают и в атласе.",
            tour_t_display: 'Слоты отображения',
            tour_b_display: "Выберите вид предмета: в руке, на голове, в инвентаре, на земле, в рамке или на полке. У каждого вида свои настройки; левая и правая руки настраиваются отдельно.",
            tour_t_preview: 'Открыть в Blockbench',
            tour_b_preview: "Откройте выбранный вид в Blockbench, чтобы проверить модель. Окно экспорта закроется. После правок снова откройте Экспорт obj³: изменения загрузятся для экспорта.",
            tour_t_transform: 'Позиция, поворот, масштаб',
            tour_b_transform: "Задайте поворот, положение и размер по X, Y и Z для выбранного вида. Введите числа или потяните поля в сторону. Результат можно посмотреть в Blockbench.",
            tour_t_animation: 'Анимация',
            tour_b_animation: "Включите экспорт анимации Blockbench. Ниже выберите анимацию и нужный отрезок. Если настройка выключена, экспортируется только текущая поза.",
            tour_t_animselect: 'Клип анимации',
            tour_b_animselect: "Выберите одну анимацию из проекта. Другие анимации можно экспортировать отдельно, задав каждой свой ID модели.",
            tour_t_fps: "Кадров в секунду",
            tour_b_fps: "Укажите число сохраняемых кадров на секунду анимации. Чем их больше, тем подробнее движение и больше файл. Длительность анимации остаётся прежней.",
            tour_t_range: "Начало / Конец",
            tour_b_range: "Укажите начало и конец экспортируемого отрезка в секундах. Для всей анимации оставьте начало 0, а конец равным её полной длине.",
            tour_t_autoplay: 'Автозапуск',
            tour_b_autoplay: "Включите автоматическое повторение анимации. Для управления командами включите датапак: его настройки будут управлять воспроизведением.",
            tour_t_color: 'Поведение цвета',
            tour_b_color: "Нажмите R, G или B, чтобы выбрать окраску, анимацию, оттенок или красную вспышку для канала цвета зелья. Режимы каналов сочетаются. У надетой экипировки управление воспроизведением отдельное.",
            tour_t_datapack: 'Управление датапаком',
            tour_b_datapack: "Создайте команды запуска, остановки и выбора кадров анимации. Установите созданную папку в datapacks мира и выполните /reload. Команды перечислены в README.txt.",
            tour_t_datapackid: "Имя анимации и пространство имён",
            tour_b_datapackid: "Задайте имя анимации и пространство имён для её команд. Разным анимациям нужны разные имена, чтобы их экспорты не перезаписывали друг друга.",
            tour_t_datapacktarget: 'Цель и слот датапака',
            tour_b_datapacktarget: "Выберите носителя или сущность отображения и слот с анимированным предметом. Для экипировки мобов и элитр цель и слот определяются выбранным типом.",
            tour_t_equipment: 'Экипировка / броня',
            tour_b_equipment: "Включите для брони, сёдел, упряжи, попон или элитр. Выберите тип экипировки; для мобов ниже появится список доступных привязок.",
            tour_t_equipslot: 'Части брони',
            tour_b_equipslot: "Выберите части брони для экспорта. Назначьте нужные группы через ПКМ → obj³: Часть тела. Для экипировки мобов используйте её доступные привязки.",
            tour_t_respack: 'Папка ресурспака',
            tour_b_respack: "Выберите папку ресурспака для сохранения модели. Кнопка с папкой открывает выбор каталога. Команда выдачи модели тоже сохранится в этом пакете.",
            tour_t_baseitem: 'Базовый предмет',
            tour_b_baseitem: "Выберите предмет Minecraft для выдачи модели, например iron_ingot. Несколько моделей могут использовать один предмет, если у каждой свой ID.",
            tour_t_cmdname: 'Имя модели',
            tour_b_cmdname: "Задайте уникальный ID модели. Он используется в команде выдачи, которая сохраняется в ресурспаке. При повторном экспорте прежние команды сохраняются.",
            tour_t_easing: "Переходы кадров",
            tour_b_easing: "Выберите переходы между сохранёнными кадрами. «Нет» показывает кадры без переходов; остальные режимы сглаживают движение между ними.",
            tour_t_autorotate: 'Автоповорот',
            tour_b_autorotate: "Выберите, следует ли модель повороту по горизонтали, вертикали или обеим осям. По умолчанию выбрано «Оба». Направление модели также можно задать настройками отображения.",
            tour_t_flags: "Дополнительные настройки",
            tour_b_flags: "Свечение всей модели сохраняет яркость всех её частей в темноте. Переворот текстуры меняет её верх и низ. Сохранение высоты PNG может уменьшить файл. Подробности — под «?».",
            tour_t_emissive: 'Светящиеся кубы',
            tour_b_emissive: "Чтобы куб или меш оставался ярким в темноте, включите ПКМ → obj³: Переключить свечение в списке элементов. Светятся только выбранные элементы; окружающий мир они не освещают.",
            tour_t_export: 'Экспорт',
            tour_b_export: "Когда настройки готовы, экспортируйте модель. Файлы и команды выдачи сохранятся в выбранном ресурспаке. Включите пакет в Minecraft и используйте сохранённую команду выдачи.",
        }
    };

    function t(key) {
        const lang = (typeof settings !== 'undefined' && settings.language) ? settings.language.value : 'en';
        return (LANG[lang] && LANG[lang][key]) || LANG.en[key] || key;
    }

    /**
     * Language-aware plural helper. Picks the correct grammatical form for `n`
     * in the active language and looks it up as `key + '_' + form`:
     *   - EN: standard one/other  → keys X_one / X_other
     *   - RU: standard Slavic rule → keys X_one / X_few / X_many
     *       one  : n%10==1 && n%100!=11      (1, 21, 31 … кадр)
     *       few  : n%10 in 2..4 && n%100 not in 12..14  (2-4, 22-24 … кадра)
     *       many : everything else           (0, 5-20, 25-30 … кадров)
     * Falls back gracefully so a missing form never crashes: try the chosen
     * form, then '_other', then '_one', then the bare key.
     */
    function pluralForm(n, lang) {
        if (lang === 'ru') {
            const mod10 = n % 10, mod100 = n % 100;
            if (mod10 === 1 && mod100 !== 11) return 'one';
            if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
            return 'many';
        }
        return (n === 1) ? 'one' : 'other';
    }
    function tPlural(n, key) {
        const lang = (typeof settings !== 'undefined' && settings.language) ? settings.language.value : 'en';
        const form = pluralForm(n, lang);
        const dict = (LANG[lang] && LANG[lang][key + '_' + form] != null) ? LANG[lang] : LANG.en;
        // Resolve against the chosen dict with graceful fallback to other shapes.
        const pick = (suf) => dict[key + suf];
        const val = pick('_' + form) || pick('_other') || pick('_one') || pick('') || (key + '_' + form);
        return val;
    }

    // Surface a warning to the USER (not just the dev console). Many export
    // problems used to only console.warn, so users saw "Done!" while geometry
    // was silently missing. Routes through Blockbench's toast when available;
    // falls back to console only (headless/tests). Pass a ready string.
    function surfaceWarning(msg) {
        console.warn('[obj³] ' + msg);
        try {
            if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                Blockbench.showQuickMessage('obj³: ' + msg, 4500);
            }
        } catch (e) { /* no Blockbench (tests/headless) — console is enough */ }
    }

    // (BBPlugin.register lives at the very END of the IIFE so that every
    // helper and module-level let/const it touches via onload/onunload
    // — installProjectPersistence, _compileHandler, installStylesheet,
    // STYLESHEET_ID, etc. — has been declared and initialized by the time
    // Blockbench synchronously fires those lifecycle callbacks during the
    // plugin reload.)

    // =========================================================
    // Section 1.3: Plugin Stylesheet (injected once on load)
    // =========================================================
    // Classes used inside the dialog template. Keeping styles centralized
    // here lets Stage 7 (polish) extend them without touching the template.
    const STYLESHEET_ID = 'objcubed-styles';
    const STYLESHEET = `
        /* BlockBench's own stylesheet gives form controls a non-zero
           min-width that pushes ranges/selects past their grid cells.
           We override with !important to win the specificity war. */
        .oc-root, .oc-root * { box-sizing: border-box; }
        .oc-root {
            font-family: 'Noto Sans', sans-serif; font-weight: 400;
            --oc-scale: 1.25;
            --oc-fs: calc(14px * var(--oc-scale));
            font-size: var(--oc-fs);
        }
        .oc-root h2, .oc-root h3,
        .oc-root button, .oc-root .oc-section-head { font-family: 'Motiva Sans', 'Noto Sans', sans-serif; }
        .oc-root .material-icons { font-family: 'Material Icons' !important; font-weight: normal !important; }

        .oc-root input,
        .oc-root select,
        .oc-root textarea,
        .oc-root button {
            min-width: 0 !important;
            font-family: inherit;
        }
        .oc-root input[type=range] {
            min-width: 0 !important;
            width: 100% !important;
            accent-color: #5a8cc0;
        }
        .oc-root button { align-items: center; justify-content: center; }
        .oc-output-options {
            display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;
            color: #aaa; font-size: calc(12px * var(--oc-scale)); line-height: 1.2;
        }
        .oc-output-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .oc-output-options select, .oc-output-options input:not([type=checkbox]) {
            font: inherit; color: inherit; height: calc(24px * var(--oc-scale));
            line-height: 1.2; padding: 0 6px;
        }
        .oc-output-path { display: flex; align-items: center; gap: 6px; }
        .oc-output-path input { flex: 1; min-width: 0; }
        .oc-output-browse { flex: 0 0 calc(24px * var(--oc-scale)); height: calc(24px * var(--oc-scale)); padding: 0; }
        .oc-output-browse .material-icons { font-size: calc(16px * var(--oc-scale)); line-height: 1; }
        .oc-context-options { display: flex; flex-wrap: wrap; gap: 8px 12px; }
        .oc-context-options label { display: inline-flex; align-items: center; gap: 4px; }
        .oc-root input[type=checkbox] { accent-color: #5a8cc0; }
        .oc-root input[type=number],
        .oc-root input[type=text],
        .oc-root input:not([type]) { width: 100%; }

        /* Focus rings — replace ugly browser default with a plugin-toned ring */
        .oc-root input:focus-visible,
        .oc-root select:focus-visible,
        .oc-root textarea:focus-visible,
        .oc-root button:focus-visible {
            outline: 2px solid #5a8cc0;
            outline-offset: 1px;
        }

        /* Inline error message under a field — same style as AnimatedJava */
        .oc-err-msg {
            display: flex; align-items: center; gap: 4px;
            color: #f88; font-size: calc(11px * var(--oc-scale));
            margin-top: 2px;
            line-height: 1.3;
        }
        .oc-err-msg::before {
            content: '!';
            display: inline-block;
            width: 12px; height: 12px;
            border-radius: 50%;
            background: #c44; color: #fff;
            font-weight: 700; font-size: calc(9px * var(--oc-scale));
            text-align: center; line-height: 12px;
            flex-shrink: 0;
        }

        /* Long monospace strings (datapack command sample) — wrap aggressively */
        .oc-mono-wrap { word-break: break-all; font-family: monospace; }

        .oc-help {
            position: relative;
            display:inline-block; width:calc(14px * var(--oc-scale)); height:calc(14px * var(--oc-scale));
            margin-left:4px; vertical-align:middle;
            border-radius:50%;
            background:#3a3a3a; color:#ccc;
            font-size:calc(10px * var(--oc-scale)); font-weight:700; font-family:sans-serif;
            text-align:center; line-height:calc(14px * var(--oc-scale));
            cursor:help; user-select:none;
            transition:background 120ms, color 120ms;
            flex-shrink: 0;
        }
        .oc-help:hover, .oc-help:focus-visible { background:#5a8cc0; color:#fff; }

        /* JS-driven tooltip portal — slides in from above with a soft drop. */
        .oc-tooltip {
            position: fixed;
            background: #1a1a1a;
            color: #e6e6e6;
            padding: 6px 9px;
            border: none;
            border-radius: 4px;
            font-size: calc(11px * var(--oc-scale));
            font-weight: 400;
            line-height: 1.4;
            max-width: 280px;
            z-index: 99999;
            pointer-events: none;
            box-shadow: 0 4px 16px rgba(0,0,0,0.6);
            opacity: 0;
            transform: translateY(-4px);
            transition: opacity 140ms ease-out, transform 140ms ease-out;
        }
        .oc-tooltip.visible { opacity: 1; transform: translateY(0); }

        .oc-err {
            outline: 1.5px solid #c44 !important;
            outline-offset: 1px;
            background: rgba(204,68,68,0.07) !important;
        }
        .oc-err-badge {
            display:inline-flex; align-items:center; gap:3px;
            padding:3px 9px; border-radius:11px;
            background:rgba(204,68,68,0.18); color:#f99;
            border:none;
            font-size:calc(12px * var(--oc-scale)); font-weight:600;
            cursor:help; user-select:none;
        }

        /* Section card */
        .oc-section {
            margin-bottom: 12px;
            border: none;
            border-radius: 4px;
            background: rgba(255,255,255,0.025);
        }
        .oc-section-head {
            padding: calc(8px * var(--oc-scale)) calc(10px * var(--oc-scale));
            display: flex; align-items: center; gap: 8px;
            font-weight: 600; color: #ddd;
            user-select: none;
        }
        .oc-section-head.clickable { cursor: pointer; transition: background 120ms; }
        .oc-section-head.clickable:hover { background: rgba(255,255,255,0.04); }
        .oc-section-head .material-icons {
            font-size: calc(18px * var(--oc-scale));
            color: #5a8cc0;
            opacity: 0.85;
        }
        .oc-section-body { padding: 0 calc(12px * var(--oc-scale)) calc(10px * var(--oc-scale)) calc(12px * var(--oc-scale)); }

        /* Inline buttons — borderless, BB-native style */
        .oc-btn {
            display: inline-flex; align-items: center; justify-content: center;
            padding: calc(4px * var(--oc-scale)) calc(8px * var(--oc-scale)); cursor: pointer;
            background: rgba(255,255,255,0.06); border: none;
            color: #bbb; border-radius: 4px;
            transition: background 100ms, color 100ms;
            font-family: inherit; font-size: calc(12px * var(--oc-scale));
            min-width: 0; min-height: 0;
            line-height: 1.2;
        }
        .oc-btn:hover:not(:disabled) {
            background: rgba(255,255,255,0.12); color: #fff;
        }
        .oc-btn:active:not(:disabled) { background: rgba(255,255,255,0.04); }
        .oc-btn:disabled { color: #555; cursor: not-allowed; opacity: 0.55; }
        .oc-btn-danger:hover:not(:disabled) {
            background: rgba(204,68,68,0.2); color: #fdd;
        }
        .oc-btn-primary {
            background: rgba(90,140,192,0.15); color: #9bc;
        }
        .oc-btn-primary:hover:not(:disabled) {
            background: rgba(90,140,192,0.25); color: #fff;
        }

        /* Icon-only square buttons — defensive against BB defaults.
           Force a square outer box AND clip the glyph so the icon font's
           intrinsic width can't bulge the button horizontally. */
        .oc-root .oc-icon-btn {
            width: calc(24px * var(--oc-scale)) !important;
            min-width: calc(24px * var(--oc-scale)) !important;
            max-width: calc(24px * var(--oc-scale)) !important;
            height: calc(24px * var(--oc-scale)) !important;
            min-height: calc(24px * var(--oc-scale)) !important;
            max-height: calc(24px * var(--oc-scale)) !important;
            padding: 0 !important;
            margin: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important;
            box-sizing: border-box !important;
            line-height: 1 !important;
            overflow: hidden !important;
        }
        .oc-root .oc-icon-btn .material-icons {
            font-size: calc(14px * var(--oc-scale)) !important;
            width: calc(14px * var(--oc-scale)) !important;
            height: calc(14px * var(--oc-scale)) !important;
            line-height: calc(14px * var(--oc-scale)) !important;
            display: inline-block !important;
            overflow: hidden !important;
        }

        /* Color & Tinting channel button: keeps R/G/B letter and the
           current value label in a tidy column, centered vertically. */
        .oc-cb-btn {
            padding: 6px 4px;
            background: rgba(255,255,255,0.04);
            border: none;
            border-radius: 4px;
            color: #ddd;
            text-align: center;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 2px;
            min-height: 54px;
            cursor: pointer;
        }
        .oc-cb-btn .oc-cb-letter { font-size: calc(16px * var(--oc-scale)); font-weight: 700; }
        .oc-cb-btn .oc-cb-value  { font-size: calc(11px * var(--oc-scale)); color: #bbb; }
        .oc-cb-btn { transition: background 120ms, transform 80ms; }
        .oc-cb-btn:hover  { background: rgba(255,255,255,0.08); }
        .oc-cb-btn:active { transform: scale(0.97); background: rgba(255,255,255,0.02); }

        /* Range+number row — keeps the number input from being squished
           and the slider from overflowing its grid cell. */
        .oc-range-row {
            display: grid;
            grid-template-columns: 1fr calc(44px * var(--oc-scale));
            gap: 4px;
            align-items: center;
            min-width: 0;
        }
        .oc-range-row input[type=range]  { width: 100%; min-width: 0; }
        .oc-range-row input[type=number] { width: calc(44px * var(--oc-scale)); }

        /* Primary export button — flat, borderless */
        .oc-btn-export {
            background: rgba(90,140,192,0.2) !important;
            color: #cde !important;
            border: none !important;
            padding: calc(8px * var(--oc-scale)) calc(28px * var(--oc-scale)) !important;
            font-size: calc(14px * var(--oc-scale)) !important;
            font-weight: 600 !important;
            border-radius: 5px !important;
            box-shadow: none;
            cursor: pointer;
            transition: background 140ms, color 100ms;
            font-family: inherit;
        }
        .oc-btn-export:hover:not(:disabled) {
            background: rgba(90,140,192,0.3) !important; color: #fff !important;
        }
        .oc-btn-export:active:not(:disabled) { background: rgba(90,140,192,0.15) !important; }
        .oc-btn-export:disabled { opacity: 0.45; cursor: not-allowed; }

        /* Frame count preview chip */
        .oc-frame-chip {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 3px 8px;
            background: rgba(90,140,192,0.10);
            border: none;
            border-radius: 4px;
            font-size: calc(11px * var(--oc-scale));
            color: #9bd;
            width: fit-content;
        }
        .oc-frame-chip .material-icons { font-size: calc(13px * var(--oc-scale)); color: #6aa; }

        /* Display tabs — replaces the 24-slider wall of text */
        .oc-display-tabs {
            display: flex; gap: 0;
            margin-bottom: 12px;
            flex-wrap: nowrap;
            overflow-x: auto;
        }
        .oc-display-tab {
            background: transparent; border: none;
            color: #555; padding: 8px 12px;
            cursor: pointer; font-size: calc(11px * var(--oc-scale));
            white-space: nowrap;
            transition: color 120ms, background 120ms;
            border-radius: 4px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .oc-display-tab .material-icons { font-size: calc(18px * var(--oc-scale)); }
        .oc-display-tab:hover { color: #bbb; background: rgba(255,255,255,0.05); }
        .oc-display-tab.active {
            color: #5a8cc0;
            background: rgba(90,140,192,0.1);
        }

        /* Issue #10: "Open in Blockbench Display editor" button + note.
           Replaces the old in-dialog preview (BB's renderer can't live in a
           modal); we drive BB's own native Display editor instead. */
        .oc-display-preview {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
            margin-bottom: 12px;
            padding: 8px;
            background: rgba(0,0,0,0.18);
            border-radius: 6px;
        }
        .oc-open-display-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 7px 12px;
            border: none;
            border-radius: 4px;
            background: rgba(90,140,192,0.25);
            color: #cde;
            font-weight: 600;
            font-size: calc(12px * var(--oc-scale));
            cursor: pointer;
        }
        .oc-open-display-btn:hover:not(:disabled) { background: rgba(90,140,192,0.4); }
        .oc-open-display-btn:disabled { opacity: 0.45; cursor: default; }
        .oc-open-display-btn .material-icons { font-size: calc(16px * var(--oc-scale)); }
        .oc-display-preview-note {
            color: #888;
            font-size: calc(10px * var(--oc-scale));
            line-height: 1.3;
        }

        /* XYZ number inputs with colored corner indicators */
        .oc-xyz-row {
            display: grid;
            grid-template-columns: calc(70px * var(--oc-scale)) 1fr 1fr 1fr;
            gap: 6px;
            align-items: center;
            margin-bottom: 4px;
        }
        .oc-xyz-row > span { color: #777; font-size: calc(11px * var(--oc-scale)); }
        .oc-xyz-input {
            position: relative;
        }
        .oc-xyz-input input {
            width: 100%;
            padding: 5px 6px 5px 14px;
            background: rgba(255,255,255,0.04);
            border: none;
            border-radius: 3px;
            color: #ddd;
            font-family: 'Noto Sans', sans-serif;
            font-size: calc(12px * var(--oc-scale));
        }
        .oc-xyz-input { cursor: ew-resize; }
        .oc-xyz-input input { cursor: ew-resize; }
        .oc-xyz-input input:hover { background: rgba(255,255,255,0.07); }
        .oc-xyz-input input:focus { background: rgba(255,255,255,0.06); outline: 1px solid rgba(90,140,192,0.4); cursor: text; }
        .oc-xyz-input::before {
            content: '';
            position: absolute;
            left: 0; top: 0;
            width: 0; height: 0;
            border-style: solid;
            border-width: 6px 6px 0 0;
            border-radius: 3px 0 0 0;
            z-index: 1;
            pointer-events: none;
        }
        .oc-xyz-input.oc-x::before { border-color: #f55 transparent transparent transparent; }
        .oc-xyz-input.oc-y::before { border-color: #5b5 transparent transparent transparent; }
        .oc-xyz-input.oc-z::before { border-color: #58f transparent transparent transparent; }

        /* Texture thumbnail next to atlas checkboxes */
        .oc-tex-thumb {
            width: 22px; height: 22px;
            image-rendering: pixelated;
            border: none;
            border-radius: 3px;
            object-fit: contain;
            background: rgba(255,255,255,0.04);
            flex-shrink: 0;
        }

        /* Base-item picker: filtered dropdown with item icons */
        .oc-item-list {
            position: absolute;
            top: 100%; left: 0; right: 0;
            max-height: 220px;
            overflow-y: auto;
            z-index: 40;
            background: #17191d;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 4px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.5);
        }
        .oc-item-row {
            display: flex; align-items: center; gap: 8px;
            padding: 4px 8px;
            cursor: pointer;
            color: #ccc;
            font-size: calc(12px * var(--oc-scale));
        }
        .oc-item-row:hover { background: rgba(255,255,255,0.08); }
        .oc-item-icon {
            width: 18px; height: 18px;
            image-rendering: pixelated;
            object-fit: contain;
            flex-shrink: 0;
        }

        /* Sticky footer — pinned to bottom of the nearest scroll container
           (BlockBench Dialog body). Transparent-ish background blends with
           the dialog so the footer doesn't look like a separate panel. */
        .oc-footer-sticky {
            position: sticky;
            bottom: 0;
            margin: 14px -16px -14px -16px;
            padding: 10px 16px;
            background: inherit;
            border-top: 1px solid rgba(255,255,255,0.06);
            display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
            z-index: 5;
        }
        /* Add a subtle backdrop only when content is actually scrollable.
           Implemented via JS toggle of .oc-footer-floating on the footer. */
        .oc-footer-sticky.oc-footer-floating {
            background: rgba(20,20,20,0.85);
            backdrop-filter: blur(4px);
            box-shadow: 0 -2px 8px rgba(0,0,0,0.25);
        }

        /* Collapse transition — slide-down + fade, matches tooltip drop */
        .oc-collapse-enter-active, .oc-collapse-leave-active {
            transition: opacity 180ms ease, transform 180ms ease;
            transform-origin: top center;
        }
        .oc-collapse-enter, .oc-collapse-leave-to {
            opacity: 0;
            transform: translateY(-6px) scaleY(0.96);
        }
        .oc-collapse-enter-to, .oc-collapse-leave {
            opacity: 1;
            transform: translateY(0) scaleY(1);
        }

        /* ── Guided tour (issue #4) ──────────────────────────────────────
           Single spotlight engine: .oc-tour-hole is a transparent box whose
           huge box-shadow IS the dim everywhere except over the target — its
           transparent center lets the real content show through bright (the
           "spotlight"). No separate full-screen dim, which would otherwise
           cover the target and defeat the hole. The card narrates. All sit
           above the BlockBench dialog (z ~100000+). */
        .oc-root-head {
            display: flex; justify-content: flex-end; align-items: center;
            margin: -4px 0 8px 0;
        }
        .oc-tour-btn {
            display: inline-flex; align-items: center; gap: 5px;
            padding: calc(3px * var(--oc-scale)) calc(9px * var(--oc-scale));
            border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
            background: rgba(255,255,255,0.04); color: #cde;
            font-size: calc(12px * var(--oc-scale)); cursor: pointer;
            transition: background 120ms, color 120ms;
        }
        .oc-tour-btn:hover { background: rgba(90,140,192,0.25); color: #fff; }
        .oc-tour-btn .material-icons { font-size: calc(15px * var(--oc-scale)); }

        .oc-tour-layer { position: fixed; inset: 0; z-index: 100000; }
        .oc-tour-hole {
            position: fixed; display: none;
            border-radius: 5px;
            box-shadow: 0 0 0 9999px rgba(0,0,0,0.62);
            outline: 2px solid rgba(90,140,192,0.9);
            outline-offset: 0;
            pointer-events: none;
            z-index: 100001;
            transition: left 160ms ease, top 160ms ease, width 160ms ease, height 160ms ease;
        }
        .oc-tour-card {
            position: fixed; left: 0; top: 0;
            width: calc(300px * var(--oc-scale)); max-width: calc(100vw - 24px);
            background: #1c1c1c; color: #e6e6e6;
            border: 1px solid rgba(90,140,192,0.4); border-radius: 6px;
            padding: calc(12px * var(--oc-scale)) calc(14px * var(--oc-scale));
            box-shadow: 0 8px 28px rgba(0,0,0,0.7);
            z-index: 100002;
            font-size: calc(12px * var(--oc-scale)); line-height: 1.5;
        }
        .oc-tour-card-title {
            font-weight: 700; font-size: calc(14px * var(--oc-scale));
            color: #cde; margin-bottom: 5px;
        }
        .oc-tour-card-body { color: #cfcfcf; margin-bottom: 11px; }
        .oc-tour-card-foot {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
        }
        .oc-tour-counter { color: #888; font-size: calc(11px * var(--oc-scale)); }
        .oc-tour-card-btns { display: inline-flex; gap: 6px; }
    `;
    function installStylesheet() {
        if (document.getElementById(STYLESHEET_ID)) return;
        const el = document.createElement('style');
        el.id = STYLESHEET_ID;
        el.textContent = STYLESHEET;
        document.head.appendChild(el);
    }
    function uninstallStylesheet() {
        const el = document.getElementById(STYLESHEET_ID);
        if (el) el.remove();
    }

    // =========================================================
    // Section 1.5: Persistent Settings (stored inside .bbmodel)
    // =========================================================
    // (PERSISTABLE_FIELDS, LANG and t() are hoisted above the
    // BBPlugin.register call — see top of file.)
    // Settings live on the active Project (Project.objcubed_data) and get
    // serialized into the .bbmodel via Codecs.project compile/parse hooks.
    //
    // Data shape — a flat settings object holds all dialog fields.
    //   {
    //     version: 1,
    //     settings: { ...dialog fields... },
    //   }
    // Older projects stored a single-preset backbone
    // ({ version, activePresetIndex, presets:[{name, settings}] }); the
    // multi-preset management UI was long-removed dead code. ensureDataRoot
    // migrates those blobs in place on first access.
    //
    // File key: model.objcubed   ·   Project key: Project.objcubed_data
    const PROJECT_DATA_KEY = 'objcubed_data';     // Project[key]
    const FILE_DATA_KEY    = 'objcubed';          // .bbmodel JSON field
    const DATA_VERSION     = 1;

    function makeEmptyDataRoot() {
        return {
            version: DATA_VERSION,
            settings: {},
        };
    }

    function ensureDataRoot() {
        if (!Project) return null;
        if (!Project[PROJECT_DATA_KEY]) Project[PROJECT_DATA_KEY] = makeEmptyDataRoot();
        const root = Project[PROJECT_DATA_KEY];
        // Migrate the legacy single-preset backbone → flat settings.
        if (root.presets) {
            const active = root.presets[root.activePresetIndex || 0];
            root.settings = (active && active.settings) || {};
            delete root.presets;
            delete root.activePresetIndex;
        }
        if (!root.settings || typeof root.settings !== 'object') root.settings = {};
        return root;
    }

    // Returns the active settings object (or null if no project is open).
    // Mutate in place to update — saveActiveSettings is provided for
    // replacement semantics.
    function loadActiveSettings() {
        const root = ensureDataRoot();
        return root ? root.settings : null;
    }

    function saveActiveSettings(settings) {
        const root = ensureDataRoot();
        if (root) root.settings = settings;
    }

    // Group body-part tags persist via OUR codec hooks, not BlockBench's property
    // serializer: BB does not reliably save custom Group properties to .bbmodel
    // (Cube/Mesh props persist, Group props get dropped), so the objcubed_body_part
    // set via the right-click menu was lost on save/reload. We snapshot {uuid: part}
    // on compile and re-apply it onto the groups after parse.
    function collectBodyPartTags() {
        const map = {};
        if (typeof Group === 'undefined' || !Group.all) return map;
        for (const g of Group.all) {
            const v = g && g.objcubed_body_part;
            if (Number.isInteger(v) && v >= 0 && v <= 8 && g.uuid) map[g.uuid] = v;
        }
        return map;
    }
    function applyBodyPartTags(map) {
        if (!map || typeof Group === 'undefined' || !Group.all) return;
        for (const g of Group.all) {
            const v = g && g.uuid ? map[g.uuid] : undefined;
            if (Number.isInteger(v) && v >= -1 && v <= 8) g.objcubed_body_part = v;
        }
    }

    // Codec hooks — installed in onload, removed in onunload to keep plugin
    // reload idempotent.
    let _compileHandler = null;
    let _parseHandler = null;
    let _bodyPartTimer = null;   // deferred tag re-apply; cleared on uninstall

    function installProjectPersistence() {
        if (typeof Codecs === 'undefined' || !Codecs.project) return;
        _compileHandler = (data) => {
            if (!data || !data.model) return;
            const tags = collectBodyPartTags();
            const equipmentTags = collectEquipmentPartTags();
            const equipmentRest = collectEquipmentRestTransforms();
            const existing = Project && Project[PROJECT_DATA_KEY];
            // Write objcubed data if the user has any (settings) OR any group is tagged.
            if (existing || Object.keys(tags).length || Object.keys(equipmentTags).length || Object.keys(equipmentRest).length) {
                const root = ensureDataRoot();
                if (!root) return;
                root.bodyPartTags = tags;
                root.equipmentPartTags = equipmentTags;
                root.equipmentRestTransforms = equipmentRest;
                data.model[FILE_DATA_KEY] = root;
            }
        };
        _parseHandler = (data) => {
            if (!data || !data.model) return;
            const stored = data.model[FILE_DATA_KEY];
            if (!stored || !Project) return;
            Project[PROJECT_DATA_KEY] = stored;
            // Re-apply group tags AFTER parse finishes building the project (groups
            // don't exist yet at the 'parse' event), so deferred to the next tick.
            if ((stored.bodyPartTags || stored.equipmentPartTags || stored.equipmentRestTransforms) && typeof setTimeout === 'function') {
                const map = stored.bodyPartTags;
                if (_bodyPartTimer) clearTimeout(_bodyPartTimer);
                const _proj = (typeof Project !== 'undefined') ? Project : null;
                _bodyPartTimer = setTimeout(() => {
                    _bodyPartTimer = null;
                    if (((typeof Project !== 'undefined') ? Project : null) === _proj) {
                        applyBodyPartTags(map); applyEquipmentPartTags(stored.equipmentPartTags);
                        applyEquipmentRestTransforms(stored.equipmentRestTransforms);
                    }
                }, 0);
            }
        };
        Codecs.project.on('compile', _compileHandler);
        Codecs.project.on('parse',   _parseHandler);
    }

    function uninstallProjectPersistence() {
        if (typeof Codecs === 'undefined' || !Codecs.project) return;
        // Blockbench's event API exposes removeListener; guard for older builds.
        const codec = Codecs.project;
        if (typeof codec.removeListener === 'function') {
            if (_compileHandler) codec.removeListener('compile', _compileHandler);
            if (_parseHandler)   codec.removeListener('parse',   _parseHandler);
        } else if (codec.events) {
            // Fallback: clear by reference if events bag is exposed.
            for (const evt of ['compile', 'parse']) {
                const arr = codec.events[evt];
                if (!Array.isArray(arr)) continue;
                for (let i = arr.length - 1; i >= 0; i--) {
                    if (arr[i] === _compileHandler || arr[i] === _parseHandler) arr.splice(i, 1);
                }
            }
        }
        _compileHandler = _parseHandler = null;
        if (_bodyPartTimer) { clearTimeout(_bodyPartTimer); _bodyPartTimer = null; }
    }

    // =========================================================
    // Section 1: PNG Encoder (Node.js zlib — bypasses canvas premultiplied alpha)
    // =========================================================
    function encodePNG(width, height, rgbaUint8) {
        const zlib = require('zlib');
        const crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c;
        }
        function crc32(buf) {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        }
        function chunk(type, data) {
            const tBuf = Buffer.from(type, 'ascii');
            const dBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(dBuf.length, 0);
            const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, dBuf])), 0);
            return Buffer.concat([lenBuf, tBuf, dBuf, crcBuf]);
        }
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
        ihdr[8] = 8; ihdr[9] = 6;
        // Respect a typed-array VIEW's byteOffset/byteLength: `Buffer.from(view.buffer)`
        // alone would wrap the whole underlying ArrayBuffer (ignoring a .subarray() span).
        const src = Buffer.isBuffer(rgbaUint8) ? rgbaUint8
            : (rgbaUint8 && rgbaUint8.buffer)
                ? Buffer.from(rgbaUint8.buffer, rgbaUint8.byteOffset, rgbaUint8.byteLength)
                : Buffer.from(rgbaUint8);
        const scanLen = 1 + width * 4;
        const raw = Buffer.alloc(height * scanLen, 0);
        for (let y = 0; y < height; y++) {
            raw[y * scanLen] = 0;
            src.copy(raw, y * scanLen + 1, y * width * 4, (y + 1) * width * 4);
        }
        const idat = zlib.deflateSync(raw, { level: 6 });
        return Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
        ]);
    }

    // =========================================================
    // Section 3: Animation Baking
    // =========================================================
    // Strategy: write animated world-space positions into mesh.vertices, call
    // Codecs.obj.compile() (which reads mesh.vertices), then restore.
    //
    // Uses DELTA matrix: delta = frameMatrix * inv(restMatrix).
    // Sampled frame count for [start, end] at fps, endpoints inclusive. BB stores
    // animation length rounded to ~5 decimals, so span*fps for non-decimal fps
    // lands just BELOW the integer (1/3 s @ 24fps -> 0.33333*24 = 7.99992) and a
    // bare floor() DROPS THE FINAL KEYFRAME — armor/item play_once then freezes
    // one frame short of the artist's end pose. Snap to the nearest integer when
    // within 0.01 frame (covers BB's rounding at any sane fps); floor otherwise
    // (a mid-frame trim the user typed on purpose stays a trim).
    function frameCountOf(start, end, fps) {
        const span = (end - start) * fps;
        const n = Math.abs(span - Math.round(span)) < 0.01 ? Math.round(span) : Math.floor(span);
        return Math.max(1, n + 1);
    }
    // At frameStart the delta is identity → frame 0 matches static export exactly.
    // Any constant scene scale in BB's THREE.js root cancels out.
    async function compileAnimatedObjFrames(anim, opts) {
        // compileAnimatedObjFrames v4
        const fps        = opts.fps        || anim.snapping || 20;
        const frameStart = opts.frameStart != null ? opts.frameStart : 0;
        const frameEnd   = opts.frameEnd   != null ? opts.frameEnd   : anim.length;
        const nframes    = frameCountOf(frameStart, frameEnd, fps);
        const cameras = opts.cameraConfig ? collectExportCameras().map((element, i) => ({
            element, name: cameraName(element.name, i), frames: [], unsupported: false,
        })) : [];
        if (opts.cameraConfig && !cameras.length) throw new Error(t('err_no_cameras'));
        if (new Set(cameras.map(c => c.name)).size !== cameras.length)
            throw new Error(t('err_camera_names'));
        const filterGroups = collectBoneUUIDs();
        const filterArm  = filterGroups.size > 0;


        // Save original (rest-pose) vertex positions
        const savedVertices = new Map();
        for (const mesh of Mesh.all)
            savedVertices.set(mesh.uuid, JSON.parse(JSON.stringify(mesh.vertices)));

        // Collect armature bones and build per-vertex weight influences.
        // Try Armature class first, then fall back to outliner scan by type string.
        const allBones = [];
        if (filterArm) {
            if (typeof Armature !== 'undefined' && Armature.all) {
                for (const arm of Armature.all)
                    for (const bone of arm.getAllBones()) allBones.push(bone);
            } else {
                // Fallback: walk outliner for elements with type 'armature_bone'
                (function findBones(children) {
                    for (const el of (children || [])) {
                        if ((el.type || '').toLowerCase() === 'armature_bone' && el.vertex_weights)
                            allBones.push(el);
                        if (el.children) findBones(el.children);
                    }
                })(Outliner.root);
            }
        }

        // Capture rest matrices using frame 0 of the animation as reference.
        // We select the animation first, go to frameStart, and capture bone
        // matrices there. This ensures consistent rest reference even if a
        // previous export left bones at the last animated frame.
        const savedTime = Timeline.time;
        const boneRestInverses = new Map();
        const meshRestWorlds = new Map();
        const restInverses = new Map(); // rigid parent-bone path

        // Save bone local transforms for restoration after export
        const savedBoneLocal = new Map();
        for (const bone of allBones) {
            if (!bone.mesh) continue;
            savedBoneLocal.set(bone.uuid, {
                p: bone.mesh.position.clone(),
                q: bone.mesh.quaternion.clone(),
                s: bone.mesh.scale.clone(),
            });
        }

        // Compute bone rest world matrices from static BB properties (bone.origin + bone.rotation)
        // by chaining through the BB outliner parent hierarchy.
        // We cannot use bone.mesh.matrixWorld because:
        //   1) Animation preview may be active, contaminating bone transforms
        //   2) Three.js hierarchy is nested (child bones under parent bones),
        //      so matrixWorld includes animated parent bone transforms
        if (allBones.length > 0) {
            const DEG2RAD = Math.PI / 180;
            const boneRestWorldMap = new Map(); // uuid → Matrix4
            const boneSet = new Set(allBones.map(b => b.uuid));

            // Get armature world matrix from a root bone's Three.js parent.
            // The armature itself doesn't animate, so this is stable.
            let armatureWorld = null;
            for (const bone of allBones) {
                if (!bone.mesh) continue;
                // Walk up BB outliner to find a root bone (no bone parent)
                let p = bone;
                while (p.parent && boneSet.has(p.parent.uuid)) p = p.parent;
                // p is now a root bone; its Three.js mesh parent is the armature
                if (p.mesh && p.mesh.parent) {
                    p.mesh.parent.updateWorldMatrix(true, false);
                    armatureWorld = new THREE.Matrix4().copy(p.mesh.parent.matrixWorld);
                    break;
                }
            }

            function getBoneRestWorld(bone) {
                if (boneRestWorldMap.has(bone.uuid)) return boneRestWorldMap.get(bone.uuid);
                const origin = bone.origin || [0, 0, 0];
                const rotation = bone.rotation || [0, 0, 0];
                const restLocal = new THREE.Matrix4();
                restLocal.makeRotationFromEuler(new THREE.Euler(
                    rotation[0] * DEG2RAD, rotation[1] * DEG2RAD, rotation[2] * DEG2RAD
                ));
                restLocal.setPosition(origin[0], origin[1], origin[2]);

                // Find parent bone in BB outliner hierarchy
                let parentBone = null;
                let pp = bone.parent;
                while (pp) {
                    if (boneSet.has(pp.uuid)) { parentBone = pp; break; }
                    pp = pp.parent;
                }

                const restWorld = new THREE.Matrix4();
                if (parentBone) {
                    restWorld.multiplyMatrices(getBoneRestWorld(parentBone), restLocal);
                } else if (armatureWorld) {
                    restWorld.multiplyMatrices(armatureWorld, restLocal);
                } else {
                    restWorld.copy(restLocal);
                }
                boneRestWorldMap.set(bone.uuid, restWorld);
                return restWorld;
            }

            for (const bone of allBones) {
                if (!bone.mesh) continue;
                boneRestInverses.set(bone.uuid,
                    new THREE.Matrix4().copy(getBoneRestWorld(bone)).invert());
            }
        }

        const results   = [];
        let firstMtl = '';
        try {
            anim.select();

            // Go to frameStart and preview
            Timeline.time = frameStart;
            Animator.preview();
            await new Promise(r => setTimeout(r, 0));
            // Mesh world matrices
            for (const mesh of Mesh.all) {
                if (mesh.mesh) {
                    mesh.mesh.updateWorldMatrix(true, false);
                    meshRestWorlds.set(mesh.uuid, {
                        world: new THREE.Matrix4().copy(mesh.mesh.matrixWorld),
                        inverse: new THREE.Matrix4().copy(mesh.mesh.matrixWorld).invert()
                    });
                }
            }
            // Per-parent-bone rest inverses (rigid-body path)
            for (const mesh of Mesh.all) {
                if (!(mesh.parent instanceof Group) || !mesh.parent.mesh) continue;
                mesh.parent.mesh.updateWorldMatrix(true, false);
                const inv = new THREE.Matrix4()
                    .copy(mesh.parent.mesh.matrixWorld)
                    .invert();
                restInverses.set(mesh.uuid, inv);
            }

            // Per-armature-bone influence maps (weighted path)
            const meshInfluences = new Map(); // mesh.uuid → Map<vkey, [{bone, weight}]>
            const meshToMeshId = new Map(); // mesh.uuid → meshShortID (hoisted for diagnostics)
            if (allBones.length > 0) {
                // Build per-mesh influence maps with meshID-aware matching.
                // BB weight keys use "meshShortID:vertexKey" format. We match
                // the meshShortID to the correct mesh via best-overlap to avoid
                // cross-mesh weight contamination when bare vertex keys collide.

                // Step 1: Collect meshID → Set<bareKey> from all bone weights
                const meshIdKeysets = new Map();
                const allWeightEntries = []; // [{bone, fullKey, meshId, bareKey, weight}]
                for (const bone of allBones) {
                    const src = bone.vertex_weights || bone.weights;
                    if (!src) continue;
                    const entries = src instanceof Map ? [...src.entries()] : Object.entries(src);
                    for (const [wk, w] of entries) {
                        const numW = +(w || 0);
                        if (numW <= 0) continue;
                        let meshId = null, bareKey = wk;
                        if (wk.includes(':')) {
                            const ci = wk.indexOf(':');
                            meshId = wk.substring(0, ci);
                            bareKey = wk.substring(ci + 1);
                            if (!meshIdKeysets.has(meshId)) meshIdKeysets.set(meshId, new Set());
                            meshIdKeysets.get(meshId).add(bareKey);
                        }
                        allWeightEntries.push({ bone, fullKey: wk, meshId, bareKey, weight: numW });
                    }
                }

                // Step 2: Map meshShortID → mesh element.
                // BB uses first 6 hex chars of uuid (no dashes) as the meshShortID
                // in weight keys. Try multiple prefix lengths for robustness.
                // meshToMeshId is hoisted above for diagnostic access
                const meshIdSet = new Set(meshIdKeysets.keys());
                const usedMeshIds = new Set();
                const usedMeshUuids = new Set();

                // Detect prefix length: find the length that gives 1:1 mapping
                const sampleId = [...meshIdSet][0] || '';
                const prefixLen = sampleId.length;

                // Build uuid-prefix → mesh lookup
                const byPrefix = new Map();
                for (const mesh of Mesh.all) {
                    if (!mesh.uuid) continue;
                    const stripped = mesh.uuid.replace(/-/g, '');
                    // Try the detected prefix length, plus common lengths 6, 8
                    for (const len of new Set([prefixLen, 6, 8])) {
                        if (len > 0 && len <= stripped.length) {
                            const key = stripped.substring(0, len);
                            if (!byPrefix.has(key)) byPrefix.set(key, mesh);
                        }
                    }
                    byPrefix.set(mesh.uuid, mesh); // full uuid too
                }

                // Match each meshID to a mesh
                for (const meshId of meshIdSet) {
                    const match = byPrefix.get(meshId);
                    if (match && !usedMeshUuids.has(match.uuid)) {
                        meshToMeshId.set(match.uuid, meshId);
                        usedMeshIds.add(meshId);
                        usedMeshUuids.add(match.uuid);
                    }
                }
                // Step 3: Build per-mesh influence maps using correct meshID
                for (const mesh of Mesh.all) {
                    const myMeshId = meshToMeshId.get(mesh.uuid);
                    const myKeys = new Set(Object.keys(mesh.vertices));
                    const vmap = new Map();
                    for (const { bone, meshId, bareKey, weight } of allWeightEntries) {
                        if (!myKeys.has(bareKey)) continue;
                        // Accept if: weight has matching meshID, or weight has no meshID prefix
                        if (meshId && meshId !== myMeshId) continue;
                        if (!vmap.has(bareKey)) vmap.set(bareKey, []);
                        vmap.get(bareKey).push({ bone, weight });
                    }
                    if (vmap.size > 0) meshInfluences.set(mesh.uuid, vmap);
                }
                if (meshInfluences.size === 0 && allBones.length > 0)
                    console.warn('[obj3] WARNING: No weight matches — meshes will stay in rest pose');
            }

            // Template for consistent face topology across frames
            let templateLines = null, templateVIdx = null;
            const warnedBones = new Set();

            // Bake each frame
            for (let i = 0; i < nframes; i++) {
                Timeline.time = frameStart + i / fps;
                Animator.preview();
                for (const camera of cameras) {
                    const sample = sampleExportCamera(camera.element, opts.cameraConfig);
                    camera.frames.push(sample.pose);
                    camera.unsupported ||= sample.unsupported;
                }

                // Update all bone matrices once per frame
                if (allBones.length > 0)
                    for (const bone of allBones)
                        if (bone.mesh) bone.mesh.updateWorldMatrix(true, false);

                for (const mesh of Mesh.all) {
                    const weightMap = meshInfluences.get(mesh.uuid);
                    const original = savedVertices.get(mesh.uuid);

                    // Use the same bind matrices, mesh-scoped weights and rig
                    // evaluation as Blockbench's preview (5.1/5.2). Rebuilding
                    // these from raw weight keys can animate an unrelated mesh
                    // when its vertex keys happen to match another mesh's.
                    const armature = typeof mesh.getArmature === 'function' ? mesh.getArmature() : null;
                    if (armature && typeof armature.calculateVertexDeformation === 'function') {
                        const offsets = armature.calculateVertexDeformation(mesh);
                        for (const [vkey, pos] of Object.entries(original)) {
                            const delta = offsets[vkey] || [0, 0, 0];
                            mesh.vertices[vkey] = pos.map((value, axis) => value + delta[axis]);
                        }
                        continue;
                    }

                    if (weightMap && weightMap.size > 0) {
                        // Weighted skinning with local↔world coordinate conversion
                        const mwd = meshRestWorlds.get(mesh.uuid);
                        const mw  = mwd ? mwd.world.elements : null;
                        const mwi = mwd ? mwd.inverse.elements : null;
                        for (const [vkey, pos] of Object.entries(original)) {
                            const influences = weightMap.get(vkey);
                            if (!influences) { mesh.vertices[vkey] = [...pos]; continue; }

                            const [lx, ly, lz] = pos;
                            // Local → world (rest pose)
                            const wx = mw ? mw[0]*lx+mw[4]*ly+mw[8]*lz+mw[12] : lx;
                            const wy = mw ? mw[1]*lx+mw[5]*ly+mw[9]*lz+mw[13] : ly;
                            const wz = mw ? mw[2]*lx+mw[6]*ly+mw[10]*lz+mw[14] : lz;
                            let nx = 0, ny = 0, nz = 0, tw = 0;
                            for (const { bone, weight } of influences) {
                                const restInv = boneRestInverses.get(bone.uuid);
                                if (!restInv) {
                                    if (!warnedBones.has(bone.uuid)) {
                                        console.warn(`[obj3] Bone "${bone.name || bone.uuid}" has no rest inverse — weights ignored`);
                                        warnedBones.add(bone.uuid);
                                    }
                                    continue;
                                }
                                const delta = new THREE.Matrix4()
                                    .multiplyMatrices(bone.mesh.matrixWorld, restInv);
                                const e = delta.elements;
                                nx += weight * (e[0]*wx+e[4]*wy+e[8]*wz+e[12]);
                                ny += weight * (e[1]*wx+e[5]*wy+e[9]*wz+e[13]);
                                nz += weight * (e[2]*wx+e[6]*wy+e[10]*wz+e[14]);
                                tw += weight;
                            }
                            if (tw > 0) {
                                const rx=nx/tw, ry=ny/tw, rz=nz/tw;
                                // World → local
                                mesh.vertices[vkey] = mwi
                                    ? [mwi[0]*rx+mwi[4]*ry+mwi[8]*rz+mwi[12],
                                       mwi[1]*rx+mwi[5]*ry+mwi[9]*rz+mwi[13],
                                       mwi[2]*rx+mwi[6]*ry+mwi[10]*rz+mwi[14]]
                                    : [rx, ry, rz];
                            } else {
                                mesh.vertices[vkey] = [...pos];
                            }
                            // No longer logging per-vertex: round-trip verify catches encoding errors
                        }
                    } else if (mesh.parent instanceof Group && mesh.parent.mesh
                               && (mesh.parent.type || '').toLowerCase() === 'armature_bone') {
                        // Rigid path for meshes parented to armature bones
                        // (regular group keyframe transforms are handled by BB's OBJ compiler)
                        mesh.parent.mesh.updateWorldMatrix(true, false);
                        const restInv = restInverses.get(mesh.uuid);
                        if (!restInv) continue;
                        const delta = new THREE.Matrix4()
                            .multiplyMatrices(mesh.parent.mesh.matrixWorld, restInv);
                        const e = delta.elements;
                        for (const [vkey, lp] of Object.entries(original)) {
                            const [x, y, z] = lp;
                            mesh.vertices[vkey] = [
                                e[0]*x + e[4]*y + e[8]*z  + e[12],
                                e[1]*x + e[5]*y + e[9]*z  + e[13],
                                e[2]*x + e[6]*y + e[10]*z + e[14],
                            ];
                        }
                    }
                }

                const compile = () => Codecs.obj.compile();
                const safeCompile = () => withNonGeoHidden(compile);
                const c = filterArm ? await withArmatureHidden(safeCompile) : await safeCompile();
                let objStr = typeof c === 'string' ? c : (c.obj || '');
                if (i === 0) firstMtl = (typeof c === 'object' && c.mtl) ? c.mtl : '';
                if (filterGroups) objStr = filterObjBones(objStr, filterGroups);

                // Template approach: use frame 0's face topology for all frames.
                // Codecs.obj.compile() can produce different face indices when vertex
                // positions change (triangulation, vertex welding), which breaks
                // objmc animation. Fix: freeze everything except 'v ' lines.
                if (i === 0) {
                    templateLines = objStr.split('\n');
                    templateVIdx = [];
                    for (let li = 0; li < templateLines.length; li++)
                        if (templateLines[li].startsWith('v ')) templateVIdx.push(li);
                    // Debug: log group→vertex structure
                    let dbgGroup = null;
                    let dbgVCount = 0;
                    const dbgGroups = [];
                    for (const l of templateLines) {
                        if (l.startsWith('o ') || l.startsWith('g ')) {
                            if (dbgGroup) dbgGroups.push(`${dbgGroup}:${dbgVCount}v`);
                            dbgGroup = l.substring(2).trim(); dbgVCount = 0;
                        } else if (l.startsWith('v ')) dbgVCount++;
                    }
                    if (dbgGroup) dbgGroups.push(`${dbgGroup}:${dbgVCount}v`);
                    console.log(`[obj3-anim] F0 template: ${templateVIdx.length} vertices, groups: [${dbgGroups.join(', ')}]`);
                } else if (templateLines) {
                    // Extract v-lines from current frame and substitute into template
                    const curVLines = [];
                    const curLines = objStr.split('\n');
                    // Debug: check if group order changed
                    let dbgGroup = null, dbgVCount = 0;
                    const dbgGroups = [];
                    for (const l of curLines) {
                        if (l.startsWith('o ') || l.startsWith('g ')) {
                            if (dbgGroup) dbgGroups.push(`${dbgGroup}:${dbgVCount}v`);
                            dbgGroup = l.substring(2).trim(); dbgVCount = 0;
                        } else if (l.startsWith('v ')) { curVLines.push(l); dbgVCount++; }
                    }
                    if (dbgGroup) dbgGroups.push(`${dbgGroup}:${dbgVCount}v`);
                    if (i <= 2) console.log(`[obj3-anim] F${i}: ${curVLines.length} vertices, groups: [${dbgGroups.join(', ')}]`);
                    if (curVLines.length === templateVIdx.length) {
                        const tpl = [...templateLines];
                        for (let vi = 0; vi < templateVIdx.length; vi++)
                            tpl[templateVIdx[vi]] = curVLines[vi];
                        objStr = tpl.join('\n');
                    } else {
                        console.warn(`[obj3] F${i}: vertex count mismatch (template=${templateVIdx.length}, cur=${curVLines.length}), using raw OBJ`);
                    }
                }
                results.push(objStr);

                // Restore for next frame
                for (const mesh of Mesh.all) {
                    const saved = savedVertices.get(mesh.uuid);
                    if (saved) for (const [vk, p] of Object.entries(saved)) mesh.vertices[vk] = [...p];
                }

                if (opts.onProgress) opts.onProgress(i + 1, nframes);
                await new Promise(r => setTimeout(r, 0));
            }
        } finally {
            // Restore source vertices before evaluating the editor preview.
            // On a codec error they can still contain the baked pose; previewing
            // those first would deform the already-deformed mesh again.
            for (const mesh of Mesh.all) {
                const saved = savedVertices.get(mesh.uuid);
                if (saved) for (const [vk, p] of Object.entries(saved)) mesh.vertices[vk] = [...p];
            }
            Timeline.time = savedTime;
            Animator.preview();
            // Restore bone local transforms (prevent bones staying at last frame)
            for (const bone of allBones) {
                const s = savedBoneLocal.get(bone.uuid);
                if (s && bone.mesh) {
                    bone.mesh.position.copy(s.p);
                    bone.mesh.quaternion.copy(s.q);
                    bone.mesh.scale.copy(s.s);
                    bone.mesh.updateMatrixWorld();
                }
            }
        }
        return { objs: results, mtl: firstMtl, cameras: cameras.map(({element, ...track}) => track) };
    }

    function cameraName(name, i) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 48) || `camera_${i + 1}`;
    }
    function collectExportCameras() {
        const cameras = [];
        function walk(children) {
            for (const element of children || []) {
                if (element.export === false) continue;
                if (element.type === 'camera') cameras.push(element);
                if (element.children) walk(element.children);
            }
        }
        if (typeof Outliner !== 'undefined') walk(Outliner.root);
        return cameras;
    }
    function sampleExportCamera(camera, cfg) {
        if (!camera.mesh) throw new Error(`Camera has no preview transform: ${camera.name}`);
        camera.mesh.updateWorldMatrix(true, false);
        const p = camera.mesh.getWorldPosition(new THREE.Vector3());
        // The OBJ codec removes scene translation before reading matrixWorld.
        if (typeof scene !== 'undefined' && scene) p.sub(scene.position);
        const divisor = typeof Settings !== 'undefined' ? Number(Settings.get('model_export_scale')) : 16;
        if (!(divisor > 0)) throw new Error('Invalid OBJ export scale');
        p.divideScalar(divisor).multiplyScalar(cfg.scale || 1);
        p.add(new THREE.Vector3(...(cfg.offset || [0, 0, 0])));
        p.y -= 0.5; // Same centre-relative coordinates as the mesh payload.
        const slot = buildDisplayTransforms(cfg).fixed || {};
        const matrix = new THREE.Matrix4().fromArray(buildItemTransformMatrix(slot.rotation, slot.translation, slot.scale));
        p.applyMatrix4(matrix);
        const q = camera.mesh.getWorldQuaternion(new THREE.Quaternion());
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(q).transformDirection(matrix);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).transformDirection(matrix);
        // ItemDisplayRenderer adds a Y half-turn before rendering the item.
        p.x = -p.x; p.z = -p.z;
        direction.x = -direction.x; direction.z = -direction.z;
        up.x = -up.x; up.z = -up.z;
        const yaw = Math.atan2(-direction.x, direction.z) * 180 / Math.PI;
        const pitch = Math.atan2(-direction.y, Math.hypot(direction.x, direction.z)) * 180 / Math.PI;
        const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
        const values = [p.x, p.y, p.z, yaw, pitch];
        if (!values.every(Number.isFinite)) throw new Error(`Invalid camera transform: ${camera.name}`);
        return {pose: Object.fromEntries(['x','y','z','yaw','pitch'].map((k,i) => [k, +values[i].toFixed(6)])),
            unsupported: (right.lengthSq() > 0.5 && up.dot(new THREE.Vector3().crossVectors(right, direction)) < 0.9999) || Math.abs((camera.mesh.fov ?? camera.fov ?? 70) - 70) > 0.0001};
    }

    // =========================================================
    // Section 4: OBJ Parsing
    // =========================================================

    // Remove bone groups from an OBJ string by UUID and re-index v/vt references.
    // Codecs.obj.compile() ignores visibility on armature_bone elements, so we
    // post-process the OBJ text to strip their geometry.
    function filterObjBones(objStr, boneUUIDs) {
        if (!boneUUIDs || boneUUIDs.size === 0) return objStr;

        const lines = objStr.split('\n');

        // Pass 1: find which v/vt indices belong to bone groups
        let curBone = false, vN = 0, vtN = 0;
        const boneV = new Set(), boneVt = new Set();
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('o ') || t.startsWith('g ')) {
                curBone = boneUUIDs.has(t.substring(2).trim());
            } else if (t.startsWith('v '))  { vN++;  if (curBone) boneV.add(vN);  }
              else if (t.startsWith('vt ')) { vtN++; if (curBone) boneVt.add(vtN); }
        }
        if (boneV.size === 0) return objStr;

        // Build old→new index maps (1-based)
        const vMap = new Array(vN + 1), vtMap = new Array(vtN + 1);
        let nv = 0, nvt = 0;
        for (let i = 1; i <= vN; i++)  vMap[i]  = boneV.has(i)  ? 0 : ++nv;
        for (let i = 1; i <= vtN; i++) vtMap[i] = boneVt.has(i) ? 0 : ++nvt;

        // Pass 2: rebuild OBJ without bone sections, remap face indices
        curBone = false;
        const out = [];
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('o ') || t.startsWith('g ')) {
                curBone = boneUUIDs.has(t.substring(2).trim());
                if (!curBone) out.push(line);
            } else if (curBone) {
                continue;
            } else if (t.startsWith('f ')) {
                const parts = t.split(/\s+/);
                const remap = ['f'];
                let ok = true;
                for (let i = 1; i < parts.length; i++) {
                    if (!parts[i]) continue;
                    const r = parts[i].split('/');
                    const vi  = r[0] ? vMap[+r[0]]  : 0;
                    const vti = r[1] ? vtMap[+r[1]] : 0;
                    if (r[0] && !vi) { ok = false; break; }
                    let s = '' + (vi || '');
                    if (r.length > 1) s += '/' + (vti || '');
                    if (r.length > 2) s += '/' + (r[2] || '');
                    remap.push(s);
                }
                if (ok) out.push(remap.join(' '));
            } else {
                out.push(line);
            }
        }
        return out.join('\n');
    }

    function parseObj(content, expectedFaces) {
        const d = { positions: [], uvs: [], faces: [], faceMaterials: [], faceGroups: [], faceBlocks: [] };
        let currentMaterial = null;
        let currentGroup = null;
        let currentBlock = -1;
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line || line[0] === '#') continue;
            const parts = line.split(/\s+/);
            switch (parts[0]) {
                case 'v':  d.positions.push([+parts[1]||0, +parts[2]||0, +parts[3]||0]); break;
                case 'vt': d.uvs.push([+parts[1]||0, +parts[2]||0]); break;
                case 'usemtl': currentMaterial = parts.slice(1).join(' '); break;
                case 'o':
                case 'g': currentGroup = parts.slice(1).join(' '); currentBlock++; break;
                case 'f': {
                    const face = [];
                    for (let i = 1; i < parts.length; i++) {
                        if (!parts[i]) continue;
                        const refs = parts[i].split('/');
                        face.push([refs[0] ? +refs[0]-1 : 0, refs[1] ? +refs[1]-1 : 0]);
                    }
                    d.faces.push(face);
                    d.faceMaterials.push(currentMaterial);
                    d.faceGroups.push(currentGroup);
                    d.faceBlocks.push(currentBlock);
                    break;
                }
            }
        }
        if (expectedFaces > 0 && d.faces.length !== expectedFaces)
            throw new Error(`Face count mismatch: expected ${expectedFaces}, got ${d.faces.length}`);
        return d;
    }

    // Parse MTL string to map material names → texture filenames
    function parseMtl(mtlString) {
        const map = new Map(); // materialName → textureFilename
        let currentMtl = null;
        for (const rawLine of (mtlString || '').split('\n')) {
            const line = rawLine.trim();
            if (!line || line[0] === '#') continue;
            const parts = line.split(/\s+/);
            if (parts[0] === 'newmtl') currentMtl = parts.slice(1).join(' ');
            else if (parts[0] === 'map_Kd' && currentMtl) map.set(currentMtl, parts.slice(1).join(' '));
        }
        return map;
    }

    // Match MTL texture filenames to Texture.all indices
    function buildMaterialToTexMap(mtlMap) {
        const result = new Map(); // materialName → Texture.all index
        for (const [mtlName, texFile] of mtlMap) {
            // Strip path and extension for matching
            const baseName = texFile.replace(/^.*[/\\]/, '').replace(/\.\w+$/, '').toLowerCase();
            const texFileLower = texFile.toLowerCase();
            const idx = Texture.all.findIndex(t => {
                const tName = (t.name || '').replace(/\.\w+$/, '').toLowerCase();
                return tName === baseName || tName === texFileLower;
            });
            if (idx >= 0) result.set(mtlName, idx);
        }
        return result;
    }

    // =========================================================
    // Section 5: Vertex Indexing
    // =========================================================
    function buildVertexData(objContents, atlasInfo, partRef, faceToPart) {
        // atlasInfo: null (single texture) or { materialToTexIdx, offsets, width, height }
        // partRef/faceToPart: per-part re-centering (armor only); null = no centering.
        const count = [0, 0];
        const mem   = { pos: Object.create(null), uv: Object.create(null) };
        const data  = { positions: [], uvs: [], vertices: [] };

        let uvClamped = false;
        function remapUV(uv, material) {
            if (!atlasInfo) return uv;
            const texIdx = atlasInfo.materialToTexIdx.get(material);
            const off = texIdx !== undefined ? atlasInfo.offsets.get(texIdx) : null;
            if (!off) return uv;
            // Clamp BEFORE remapping: an out-of-range (tiling/negative) UV scaled
            // into the atlas lands inside a NEIGHBORING texture's region while
            // still passing the post-remap [0,1] checks — silently sampling the
            // wrong texture. Clamp per-texture and flag it so buildOutput warns
            // (same behavior the single-texture path gets via uvPixels).
            const u = Math.max(0, Math.min(1, uv[0]));
            const v = Math.max(0, Math.min(1, uv[1]));
            if (Math.abs(u - uv[0]) > 1e-6 || Math.abs(v - uv[1]) > 1e-6) uvClamped = true;
            // V remap, uv_height-aware. BB uv space covers the FIRST (top) frame
            // for BB-animated textures (uvh = frame height) and the whole image
            // otherwise (uvh = h, reduces to the classic v*h + off.y). The atlas
            // stores each region V-FLIPPED, so the image-top uv area lands at the
            // BOTTOM of the region: off.y + off.h - uvh + v*uvh. This is exactly
            // the frame-0 band the shader cycles from.
            const uvh = off.uvh || off.h;
            return [
                u * off.w / atlasInfo.width,
                (v * uvh + off.y + off.h - uvh) / atlasInfo.height
            ];
        }

        function indexVert(o, vert, material, part) {
            let pos = o.positions[vert[0]] || [0,0,0];
            if (partRef) { const r = partRef.get(part); if (r) pos = [pos[0]-r[0], pos[1]-r[1], pos[2]-r[2]]; }
            const rawUv = o.uvs[vert[1]]    || [0,0];
            const uv = remapUV(rawUv, material);
            const pk  = pos.join(',');
            const uk  = uv[0].toFixed(8) + ',' + uv[1].toFixed(8);
            let pi = mem.pos[pk];
            if (pi === undefined) { pi = count[0]++; mem.pos[pk] = pi; data.positions.push(pos); }
            let ui = mem.uv[uk];
            if (ui === undefined) { ui = count[1]++; mem.uv[uk] = ui; data.uvs.push(uv); }
            data.vertices.push([pi, ui]);
        }

        function indexObj(o) {
            for (let fi = 0; fi < o.faces.length; fi++) {
                const face = o.faces[fi];
                const mtl = o.faceMaterials[fi];
                const part = faceToPart ? faceToPart[fi] : -1;
                const n = Math.min(4, face.length);
                for (let i = 0; i < n; i++) indexVert(o, face[i], mtl, part);
                // Pad a triangle to a quad by repeating the LAST vertex (v0,v1,v2,v2):
                // the 2nd sub-triangle (v0,v2,v2) is then zero-area/degenerate. Repeating
                // the MIDDLE vertex instead gave (v0,v2,v1) — a reverse-wound coincident
                // face that flickers / z-fights.
                if (face.length === 3) indexVert(o, face[2], mtl, part);
                if (face.length > 4) console.warn('[obj3] N-Gon — only first 4 verts used');
            }
        }

        const firstObj = parseObj(objContents[0], 0);
        const nfaces   = firstObj.faces.length;
        indexObj(firstObj);
        for (let f = 1; f < objContents.length; f++)
            indexObj(parseObj(objContents[f], nfaces));

        return { data, nfaces, faceGroups: firstObj.faceGroups, faceBlocks: firstObj.faceBlocks, uvClamped };
    }

    // =========================================================
    // Section 6: Pixel Encoding
    // =========================================================
    const u24 = v => [Math.trunc(v/65536)&255, Math.trunc(v/256)&255, Math.trunc(v)&255];

    function posPixels(pos, scale, off) {
        return pos.map((v, i) => [...u24(8388608 + v*65536*scale + off[i]*65536), 255]);
    }
    function uvPixels(uv) {
        // Clamp to [0,1]: the shader samples within one frame, so a UV outside the
        // unit square (tiling / negative) would otherwise wrap or read garbage
        // (v*65535 overflows the 16 low bits the shader reads). A buildOutput check
        // warns the user when this clamp actually changed anything.
        return uv.map(v => [...u24(Math.max(0, Math.min(1, v)) * 65535), 255]);
    }
    function vertPixels(vert) {
        const [poi, uvi] = vert;
        return [[...u24(poi), 255], [...u24(uvi), 255]];
    }

    function getTextureRGBA(bbTexture) {
        return new Promise((resolve, reject) => {
            const src = bbTexture.source || (bbTexture.img && bbTexture.img.src);
            if (!src) { reject(new Error('Texture has no source data')); return; }
            const img = new Image();
            img.onload = () => {
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0);
                const id = cv.getContext('2d').getImageData(0, 0, w, h);
                resolve({ data: id.data, width: w, height: h });
            };
            img.onerror = () => reject(new Error('Failed to decode texture: ' + bbTexture.name));
            img.src = src;
        });
    }

    function textureFrameHeight(bbTexture, width, height, texAnimEnabled, strict = false) {
        // Blockbench's UV dimensions are a logical grid, not pixel dimensions.
        // Its native frameCount getter already accounts for that grid's aspect.
        const nativeFrames = bbTexture && bbTexture.frameCount;
        if (nativeFrames > 1) {
            if (!Number.isInteger(nativeFrames) || height % nativeFrames !== 0)
                throw new Error(`Texture height ${height} cannot be divided into ${nativeFrames} whole-pixel frames.`);
            return height / nativeFrames;
        }
        if (bbTexture && 'frameCount' in bbTexture &&
            (typeof Format === 'undefined' || Format.animated_textures !== false))
            return height; // Native undefined means a static texture, including tall ones.
        const legacyFrames = bbTexture && Number(bbTexture.frame_count);
        if (Number.isInteger(legacyFrames) && legacyFrames >= 1 && height % legacyFrames === 0)
            return height / legacyFrames;
        // Formats without native animation can still export a manually enabled
        // square-frame strip. Resolve this once for both UVs and animation bands.
        if (texAnimEnabled) {
            if (height % width === 0) return width;
            if (strict)
                throw new Error(`Animated texture strip must be a vertical stack of square frames: height ${height} is not a whole multiple of width ${width}.`);
        }
        return height;
    }

    // Build a texture atlas by stacking multiple textures vertically.
    // Returns { data: Uint8Array, width, height, offsets: Map<texIdx, {x,y,w,h}> }
    async function buildAtlas(texIndices, texAnimEnabled) {
        if (!texIndices || texIndices.length === 0) throw new Error('No textures selected for atlas');
        const texDatas = [];
        for (const idx of texIndices) {
            texDatas.push({ idx, rgba: await getTextureRGBA(Texture.all[idx]) });
        }
        const atlasW = Math.max(...texDatas.map(t => t.rgba.width));
        let atlasH = 0;
        const offsets = new Map(); // texIdx → { x, y, w, h, uvh }
        for (const t of texDatas) {
            // Pixel height covered by the OBJ's normalized 0..1 UVs: one native
            // animation frame, one manually enabled frame, or the whole image.
            const uvh = textureFrameHeight(Texture.all[t.idx], t.rgba.width, t.rgba.height, texAnimEnabled);
            offsets.set(t.idx, { x: 0, y: atlasH, w: t.rgba.width, h: t.rgba.height, uvh });
            atlasH += t.rgba.height;
        }
        const data = new Uint8Array(atlasW * atlasH * 4);
        for (const t of texDatas) {
            const off = offsets.get(t.idx);
            const src = t.rgba;
            for (let row = 0; row < src.height; row++) {
                const dstOffset = ((off.y + row) * atlasW + off.x) * 4;
                const srcOffset = row * src.width * 4;
                data.set(src.data.subarray(srcOffset, srcOffset + src.width * 4), dstOffset);
            }
        }
        return { data, width: atlasW, height: atlasH, offsets };
    }

    // =========================================================
    // Section 7: Per-Context Logic
    // =========================================================

    // Remove non-geometry elements (cameras, etc.) from the outliner tree
    // during OBJ compile. Setting visibility doesn't work because
    // Codecs.obj.compile() ignores it for some element types (same issue as
    // armature_bone). Instead we splice them out and restore after compile.
    // 'armature' is included because it's a container for child meshes.
    const GEO_WHITELIST = new Set(['cube', 'mesh', 'group', 'armature']);
    async function withNonGeoHidden(fn) {
        const removed = []; // [{arr, idx, el}]
        (function walk(children) {
            if (!children) return;
            for (let i = children.length - 1; i >= 0; i--) {
                const el = children[i];
                const t = (el.type || '').toLowerCase();
                if (!GEO_WHITELIST.has(t)) {
                    removed.push({ arr: children, idx: i, el });
                    children.splice(i, 1);
                } else if (el.children) {
                    walk(el.children);
                }
            }
        })(Outliner.root);
        try { return await fn(); }
        finally {
            // Restore in reverse order to preserve indices
            for (let i = removed.length - 1; i >= 0; i--) {
                const { arr, idx, el } = removed[i];
                arr.splice(idx, 0, el);
            }
        }
    }

    function emissionOfElement(el) {
        const n = (el.name || '').toLowerCase();
        const level = Number(el.objcubed_light_emission);
        if (Number.isFinite(level) && level > 0) return Math.min(15, Math.round(level));
        return n.endsWith('_e') || n.startsWith('emissive') ? 15 : 0;
    }

    function collectEmissiveMap() {
        const map = new Map();
        (function walk(children) {
            for (const el of (children || [])) {
                const n = (el.name || '').toLowerCase();
                const val = emissionOfElement(el);
                if (val > 0) {
                    const prev = map.get(n) || 0;
                    if (val > prev) map.set(n, val);
                }
                if (el.children) walk(el.children);
            }
        })(Outliner.root);
        return map;
    }

    // Per-piece armor: map a face's group/element name to a body-part id (0..8,
    // 8 = waist: the leggings layer's body box),
    // mirroring collectEmissiveMap. A face's part comes from the nearest ancestor
    // GROUP carrying objcubed_body_part (set via the group context menu), or its own;
    // element/group NAMES matching a part also work (fallback, also used by tests).
    const PART_NAME_TO_ID = {
        body: 0, chest: 0, torso: 0, head: 1,
        right_arm: 2, rightarm: 2, arm_r: 2, r_arm: 2,
        left_arm: 3, leftarm: 3, arm_l: 3, l_arm: 3,
        right_leg: 4, rightleg: 4, leg_r: 4, r_leg: 4,
        left_leg: 5, leftleg: 5, leg_l: 5, l_leg: 5,
        right_foot: 6, rightfoot: 6, foot_r: 6, r_foot: 6, right_boot: 6, boot_r: 6,
        left_foot: 7, leftfoot: 7, foot_l: 7, l_foot: 7, left_boot: 7, boot_l: 7,
        waist: 8, pelvis: 8, hips: 8, hip: 8,
    };
    function normPartName(s) { return (s || '').toLowerCase().trim().replace(/[ \-]+/g, '_'); }
    // Export helper: turn the dialog's per-texture checkbox array into the list of
    // checked texture indices. Array-guarded so a corrupt/hand-edited project whose
    // persisted atlasTexChecked is a non-array (null/string/object) doesn't make
    // Export throw `TypeError: …map is not a function` (Task C1).
    function atlasTexIndicesFrom(checked) {
        return (Array.isArray(checked) ? checked : []).map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    }
    function nameToPart(s) { const n = normPartName(s); return (n in PART_NAME_TO_ID) ? PART_NAME_TO_ID[n] : -1; }
    // An element's part: nearest self-or-ancestor with objcubed_body_part set, else a
    // self-or-ancestor whose NAME matches a part (closer wins). -1 if none.
    function partOfElement(el) {
        let cur = el;
        while (cur && cur !== 'root' && typeof cur === 'object') {
            const own = cur.objcubed_body_part;
            if (Number.isInteger(own) && own >= 0 && own <= 8) return own;
            const byName = nameToPart(cur.name);
            if (byName >= 0) return byName;
            cur = cur.parent;
        }
        return -1;
    }
    // Encode each geo element's part into a TEMPORARY unique name token so the OBJ codec
    // writes it into the `o` line: then every face carries ITS OWN element's part, with
    // NO dependence on the codec's emit order (which does not match an Outliner walk for
    // nested groups/meshes -- the cause of scrambled body<->arm assignment). Also carries
    // the emissive level so emissive survives the rename. Returns a restore() fn.
    function applyPartTokenNames() {
        if (typeof Outliner === 'undefined' || !Outliner.elements) return () => {};
        const isGeo = el => (typeof Cube !== 'undefined' && el instanceof Cube) ||
                            (typeof Mesh !== 'undefined' && el instanceof Mesh);
        const saved = [];
        let i = 0;
        for (const el of Outliner.elements) {
            if (!isGeo(el)) continue;
            const part = partOfElement(el);                 // -1..7
            const emis = emissionOfElement(el);
            saved.push([el, el.name]);
            el.name = `ocp${part + 1}e${emis}i${i++}`;      // part+1 -> non-negative (no '-' in OBJ name)
        }
        return () => { for (const [el, n] of saved) el.name = n; };
    }
    // Parse a face token written by applyPartTokenNames; null if not a token.
    function parseFaceToken(g) {
        const m = /^ocp(\d+)e(\d+)i\d+$/.exec(g || '');
        return m ? { part: (+m[1]) - 1, emis: +m[2] } : null;
    }
    // Geo elements (Cube/Mesh) in OBJ-emit order (depth-first), each -> its part. The
    // BB OBJ codec emits one `o` block per geo element in this order, so the Nth block
    // maps to the Nth entry here. Empty when Outliner is unavailable (unit tests).
    function collectGeoElementParts() {
        const parts = [];
        if (typeof Outliner === 'undefined' || !Outliner.root) return parts;
        const isGeo = el => (typeof Cube !== 'undefined' && el instanceof Cube) ||
                            (typeof Mesh !== 'undefined' && el instanceof Mesh);
        (function walk(children) {
            for (const el of (children || [])) {
                if (el.children && el.children.length) walk(el.children);
                else if (isGeo(el)) parts.push(partOfElement(el));
            }
        })(Outliner.root);
        return parts;
    }
    // name (normalized) -> part, from group tags keyed by element/group name. Only
    // reliable when names are unique; the fallback path (tests, or count mismatch).
    function collectBodyPartMap() {
        const map = new Map();
        if (typeof Outliner === 'undefined' || !Outliner.root) return map;
        (function walk(children, inherited) {
            for (const el of (children || [])) {
                let part = inherited;
                const own = el.objcubed_body_part;
                if (Number.isInteger(own) && own >= 0 && own <= 8) part = own;
                if (typeof part === 'number' && part >= 0) map.set(normPartName(el.name), part);
                if (el.children) walk(el.children, part);
            }
        })(Outliner.root, -1);
        return map;
    }
    // Per-face part id (0..7) or -1. ROBUST path: OBJ block index -> Nth geo element
    // -> its part (immune to duplicate element names, which collided the name map).
    // FALLBACK (no Outliner in tests, or block/element count mismatch): by NAME.
    function buildFaceToPart(faceGroups, faceBlocks) {
        // Armor path: faces carry a part-encoded token (order- and collision-proof).
        if (faceGroups && faceGroups.some(parseFaceToken)) {
            return faceGroups.map(g => { const t = parseFaceToken(g); return t ? t.part : -1; });
        }
        const blockParts = collectGeoElementParts();
        const blockCount = (faceBlocks && faceBlocks.length)
            ? faceBlocks.reduce((m, b) => (b > m ? b : m), -1) + 1 : 0;
        if (blockParts.length && blockCount === blockParts.length) {
            return faceBlocks.map(b => (b >= 0 && b < blockParts.length) ? blockParts[b] : -1);
        }
        if (blockParts.length && blockCount && blockCount !== blockParts.length) {
            console.warn(`[obj³] ${blockCount} OBJ blocks vs ${blockParts.length} geo elements — name matching fallback. Name part groups/cubes (body, right_arm, left_leg, ...).`);
        }
        const partMap = collectBodyPartMap();
        return (faceGroups || []).map(g => {
            const n = normPartName(g);
            return partMap.has(n) ? partMap.get(n) : nameToPart(g);
        });
    }
    // Per-part attach point from the tagged group's PIVOT (origin). The artist sets the
    // group pivot where the part attaches to the body; subtracting it makes the geometry
    // pivot-relative, so it anchors exactly as drawn regardless of model size/position.
    // Map<partId,[x,y,z]> in OBJ space (blocks); only groups whose pivot is set (!=0,0,0).
    function collectPartPivots() {
        const m = new Map();
        if (typeof Group === 'undefined' || !Group.all) return m;
        for (const g of Group.all) {
            const v = g && g.objcubed_body_part;
            if (typeof v !== 'number' || v < 0 || m.has(v)) continue;
            const o = g.origin;
            if (!Array.isArray(o) || (o[0] === 0 && o[1] === 0 && o[2] === 0)) continue; // unset -> bbox fallback
            m.set(v, [o[0] / 16, o[1] / 16, o[2] / 16]); // BB model units -> blocks (OBJ space)
        }
        return m;
    }
    // Per-part reference: the tagged group's PIVOT if set, else bbox-CENTER in X/Z +
    // bbox-MIN in Y (the base, for parts modelled above the grid). Subtracting it makes
    // each part pivot/centre-relative so it anchors the same wherever it's drawn.
    // Map<partId,[x,y,z]>; parts id<0 skipped.
    function computePartCenters(o, faceToPart) {
        const box = new Map(); // part -> { min:[x,y,z], max:[x,y,z] }
        for (let fi = 0; fi < o.faces.length; fi++) {
            const part = faceToPart ? faceToPart[fi] : -1;
            if (part < 0) continue;
            let b = box.get(part);
            if (!b) { b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; box.set(part, b); }
            for (const vt of o.faces[fi]) {
                const p = o.positions[vt[0]] || [0, 0, 0];
                for (let k = 0; k < 3; k++) { if (p[k] < b.min[k]) b.min[k] = p[k]; if (p[k] > b.max[k]) b.max[k] = p[k]; }
            }
        }
        // Prefer the tagged group's PIVOT (attach point the artist set) so a part anchors
        // exactly where it's drawn, on any model. Fall back to bbox-center X/Z + base Y
        // when the group pivot is unset (default 0,0,0).
        const pivots = collectPartPivots();
        const ref = new Map();
        for (const [part, b] of box) {
            const piv = pivots.get(part);
            ref.set(part, piv || [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]);
        }
        // Waist(8) is body-anchored geometry on the leggings layer: re-centering it
        // on its OWN bbox strips the artist's drawn offset from the torso (belt
        // rendered shifted). Unless the artist pivoted the waist group explicitly,
        // share the body(0) reference so waist places exactly like body-tagged geo.
        if (ref.has(8) && !pivots.get(8) && ref.has(0)) ref.set(8, ref.get(0));
        return ref;
    }

    // Collect UUIDs of all armature_bone elements (used for OBJ post-processing).
    function collectBoneUUIDs() {
        const uuids = new Set();
        (function walk(children) {
            for (const el of (children || [])) {
                if ((el.type || '').toLowerCase() === 'armature_bone')
                    uuids.add(el.uuid);
                if (el.children) walk(el.children);
            }
        })(Outliner.root);
        return uuids;
    }

    // Collect OBJ group names of hidden mesh/cube elements.
    // Check if the project has armature/bone/locator/null_object elements.
    function hasNonGeometryElements() {
        const NON_GEO = new Set(['armature', 'armature_bone', 'locator', 'null_object']);
        function walk(children) {
            for (const el of (children || [])) {
                if (NON_GEO.has((el.type || '').toLowerCase())) return true;
                if (el.children && walk(el.children)) return true;
            }
            return false;
        }
        return walk(Outliner.root);
    }

    // Rough face count of the visible geometry — used by the preview banner.
    // Walks Outliner, skipping armature_bone/locator/null_object subtrees when
    // filterArmature is on (mirrors withArmatureHidden() visibility hack).
    // Quads count as 1 (matches Codecs.obj.compile output).
    function estimateFaceCount(filterArmature) {
        const SKIP_TYPES = filterArmature
            ? new Set(['armature_bone', 'locator', 'null_object'])
            : new Set(['locator', 'null_object']);
        let total = 0;
        function walk(children) {
            for (const el of (children || [])) {
                const t = (el.type || '').toLowerCase();
                if (SKIP_TYPES.has(t)) continue;
                if (el.visibility === false) continue;
                if (t === 'cube') {
                    // Standard cube has 6 faces; respect per-face texture==null hidden faces.
                    if (el.faces) {
                        for (const key of ['north','east','south','west','up','down']) {
                            if (el.faces[key] && el.faces[key].texture !== null) total++;
                        }
                    } else total += 6;
                } else if (t === 'mesh') {
                    if (el.faces) total += Object.keys(el.faces).length;
                }
                if (el.children) walk(el.children);
            }
        }
        walk(Outliner.root);
        return total;
    }

    // Estimate the encoded PNG dimensions and byte size given face count,
    // frame count and texture dimensions. Mirrors the math in buildOutput()
    // (Section 8) but uses face count as a proxy for positions/uvs/vertices.
    function estimateOutputPng(faces, frames, tw, th, nopow) {
        if (!faces || !tw || !th) return null;
        // Per buildOutput(): vertices = nfaces * 4 per frame; positions/uvs roughly bounded by nfaces.
        const nverts = faces * 4;
        const uvH = Math.ceil(faces / tw);
        const texH = th;
        const vpH = Math.ceil(faces * 3 / tw);          // positions ≈ nfaces (3 bytes/vert × 1 vert/face overcounts; OK for warning math)
        const vtH = Math.ceil(faces * 2 / tw);
        const vH  = Math.ceil(nverts * frames * 2 / tw);
        let ty = 2 + uvH + texH + vpH + vtH + vH;
        if (!nopow) ty = 1 << Math.ceil(Math.log2(ty || 1));
        const rawBytes = tw * ty * 4;
        // PNG with zlib level 6 typically compresses pixel data to ~30-50%.
        const approxBytes = Math.round(rawBytes * 0.4);
        return { tw, ty, rawBytes, approxBytes };
    }


    // Temporarily adjust visibility for OBJ export:
    //   - SHOW armature container (so child visibility is respected by codec)
    //   - SHOW mesh/cube elements under armature (they are the real geometry)
    //   - HIDE armature_bone, locator, null_object (non-geometry / bone shapes)
    // In Generic Model format the mesh geometry lives inside the armature
    // hierarchy (often hidden), while bones are visible and export as
    // diamond/octahedron shapes we don't want.
    async function withArmatureHidden(fn) {
        // Store direct element references for reliable restoration
        const saved = []; // [{el, originalVis}]
        function saveAndSet(el, vis) {
            saved.push({ el, originalVis: el.visibility });
            el.visibility = vis;
        }

        const HIDE_TYPES = new Set(['armature_bone', 'locator', 'null_object']);
        const GEO_TYPES  = new Set(['mesh', 'cube']);

        function processTree(children, insideArmature) {
            for (const el of (children || [])) {
                const t = (el.type || '').toLowerCase();

                if (t === 'armature') {
                    // Show armature container so its children are visible to codec
                    saveAndSet(el, true);
                    if (el.children)
                        processTree(el.children, true);
                } else if (HIDE_TYPES.has(t)) {
                    // Hide bone shapes, locators, null objects
                    saveAndSet(el, false);
                    if (el.children)
                        processTree(el.children, true);
                } else if (GEO_TYPES.has(t) && insideArmature) {
                    // Keep geometry at its original visibility — don't force
                    // hidden variants (face2, mouth2, etc.) to visible
                } else if (el.children) {
                    processTree(el.children, insideArmature);
                }
            }
        }

        processTree(Outliner.root, false);
        try { return await fn(); }
        finally {
            // Restore using direct references (OutlinerNode.uuidMap may not have armature types)
            for (const { el, originalVis } of saved)
                el.visibility = originalVis;
        }
    }

    // Build display transforms for the output JSON from export dialog fields.
    //
    // GUI and first-person-hand: the shader handles these with hardcoded
    // internal transforms (isGUI / isHand branches) — omit these slots.
    //
    // World slots (thirdperson, ground, head, fixed):
    //   Rotation  — orients the element quad; the shader's autorotate reads
    //               the quad corners to derive a rotation matrix.
    //   Translation — shifts the anchor point (corner 2).
    //   Scale — NOT included. The shader computes scale from quad geometry,
    //           so display scale would double with the export Scale field.
    //
    // Source priority:
    //   1. global `display` (native BlockBench Display editor — that's the
    //      variable BB exposes; `Project.display` may also exist but `display`
    //      is the working set BB writes into on every slot edit).
    //   2. cfg.displaySlots (our dialog's legacy per-slot fields).
    //
    // We DO NOT inject defaults — slots the user didn't customise are skipped
    // entirely, so Minecraft applies its built-in item defaults (which depend
    // on the model's parent). Pumping our own "sensible" values into every
    // slot was overriding vanilla rendering in unpredictable ways.

    // ── Issue #10: pure vanilla ItemTransform matrix ──────────────────────
    // Builds the column-major 4x4 a vanilla model.json display tag applies:
    //   M = T(translation/16) * R_xyz(rotation°) * S(scale)
    // about the MODEL ORIGIN (NO baked [8,8,8] pivot). Euler order is XYZ,
    // positive angles, no axis negation — identical for every slot. THREE-free
    // and pure so it is unit-testable; the dialog feeds the result straight
    // into new THREE.Matrix4().fromArray(arr).
    //
    // Column-major layout (THREE convention): m[col*4 + row]. To transform a
    // point p:  x' = m[0]*p.x + m[4]*p.y + m[8]*p.z + m[12], etc.
    function buildItemTransformMatrix(rotDeg, transUnits, scaleVec) {
        const r = rotDeg    || [0, 0, 0];
        const tr = transUnits || [0, 0, 0];
        const s = scaleVec  || [1, 1, 1];
        const D = Math.PI / 180;
        const cx = Math.cos(r[0] * D), sx = Math.sin(r[0] * D);
        const cy = Math.cos(r[1] * D), sy = Math.sin(r[1] * D);
        const cz = Math.cos(r[2] * D), sz = Math.sin(r[2] * D);

        // R = Rx * Ry * Rz (intrinsic XYZ, matching THREE.Euler 'XYZ').
        // Standard composed rotation matrix (row-major math below, packed
        // column-major at the end).
        const r00 = cy * cz;
        const r01 = -cy * sz;
        const r02 = sy;
        const r10 = sx * sy * cz + cx * sz;
        const r11 = -sx * sy * sz + cx * cz;
        const r12 = -sx * cy;
        const r20 = -cx * sy * cz + sx * sz;
        const r21 = cx * sy * sz + sx * cz;
        const r22 = cx * cy;

        // M = R * S  (scale columns), then translation in the last column.
        const sxv = s[0], syv = s[1], szv = s[2];
        const tx = tr[0] / 16, ty = tr[1] / 16, tz = tr[2] / 16;

        // Column-major: [c0(0..3), c1(4..7), c2(8..11), c3(12..15)]
        return [
            r00 * sxv, r10 * sxv, r20 * sxv, 0,
            r01 * syv, r11 * syv, r21 * syv, 0,
            r02 * szv, r12 * szv, r22 * szv, 0,
            tx,        ty,        tz,        1,
        ];
    }

    // ── Issue #10: map a display-tab id to its d* state-field prefix ───────
    // The dialog stores per-slot transforms as flat fields like dThirdRX /
    // dFprTY / dGuiSZ; callers append {R,T,S}{X,Y,Z} to this prefix. Kept
    // exported for display-matrix.test.mjs.
    function activeSlotPrefixFor(displayTab) {
        return ({
            third:  'dThird',
            fpr:    'dFpr',
            fpl:    'dFpl',
            head:   'dHead',
            gui:    'dGui',
            ground: 'dGround',
            fixed:  'dFixed',
            shelf:  'dShelf',
        })[displayTab] || 'dThird';
    }

    // ── display-1:1 step A1: static-display detection ─────────────────────
    // The shader's world branch (isHand+isGUI==0) applies an autorotate spin
    // the BB Display editor never shows. We GATE it: if ANY WORLD display slot
    // (thirdperson_*, head, ground, fixed, on_shelf — NOT gui / firstperson_*)
    // carries a non-identity rotation/translation/scale, the static display
    // wins and the shader skips autorotate. Returns true when such a slot
    // exists. Pure + exported so a byte test can drive it.
    function hasStaticWorldDisplay(cfg) {
        const WORLD_SLOTS = [
            'thirdperson_righthand','thirdperson_lefthand',
            'head','ground','fixed','on_shelf',
        ];
        const slots = (cfg && cfg.displaySlots) || {};
        const num = (v) => (Number.isFinite(+v) ? +v : 0);
        for (const key of WORLD_SLOTS) {
            const s = slots[key];
            if (!s) continue;
            const r = (s.rotation    || [0,0,0]).map(num);
            const t = (s.translation || [0,0,0]).map(num);
            const sc = (s.scale      || [1,1,1]).map(num);
            if (r.some(v => v !== 0)) return true;
            if (t.some(v => v !== 0)) return true;
            if (sc.some(v => v !== 1)) return true;
        }
        return false;
    }

    function buildDisplayTransforms(cfg) {
        const result = {};
        const ALL_SLOTS = [
            'thirdperson_righthand','thirdperson_lefthand',
            'firstperson_righthand','firstperson_lefthand',
            'head','gui','ground','fixed','on_shelf',
        ];
        // Per-axis depth (Z) display scale: the flat carrier exposes only the
        // X/Y in-plane edges, so Z can't be MEASURED — but slots whose Sz
        // differs from min(Sx,Sy) get a v2 dynamic slot marker and the exact
        // q16 Sz rides the PNG header (assignSlotMarkers). Up to 4 such slots
        // per export; the overflow warning lives in assignSlotMarkers.
        const nativeDisplay = (typeof display !== 'undefined' && display) ||
                              (typeof Project !== 'undefined' && Project && Project.display) ||
                              null;
        const dialogSlots = cfg.displaySlots || {};

        for (const key of ALL_SLOTS) {
            // GUI: handled entirely by shader header (cfg.displaySlots.gui →
            // texture meta pixels t[8..12]). Model.json display.gui must stay
            // identity, otherwise MC applies the tag on top of shader transform.
            if (key === 'gui') continue;
            // Hands: per-slot model.json owns rotation/translation AND scale now.
            // Vanilla applies display.firstperson_* verbatim (step A2 revert);
            // the shader no longer packs/applies a hand scale.

            const nat = nativeDisplay && nativeDisplay[key];
            const dlg = dialogSlots[key];
            if (!nat && !dlg) continue;  // skip — let Minecraft use its default

            // Dialog values win over native editor. The plugin's dialog is
            // the user-facing source of truth; native editor was overriding
            // dialog values silently (legacy 85° values persisted in older
            // projects kept hijacking new defaults).
            const r = (dlg && dlg.rotation)    || (nat && nat.rotation)    || [0,0,0];
            const t = (dlg && dlg.translation) || (nat && nat.translation) || [0,0,0];
            const s = (dlg && dlg.scale)       || (nat && nat.scale)       || [1,1,1];

            const entry = {};
            if (r.some(v => v !== 0)) entry.rotation    = [...r];
            if (t.some(v => v !== 0)) entry.translation = [...t];
            if (s.some(v => v !== 1)) entry.scale       = [...s];
            if (Object.keys(entry).length) result[key] = entry;
        }

        return result;
    }

    // =========================================================
    // Section 8: Core Encode Pipeline
    // =========================================================
    async function buildOutput(cfg, objContents, mtlString) {
        // objContents: string[] — one OBJ per frame (already compiled/baked)
        if (!objContents || !objContents.length || !objContents[0])
            throw new Error('No OBJ content');

        const nframes   = objContents.length;

        // Determine texture(s): atlas if multiple textures referenced, else single
        let texData; // { data, width, height }
        let atlasInfo = null; // null = single texture, otherwise atlas UV remap info

        // Map material names → Texture.all indices
        // Try MTL file first, then fall back to BB's m_UUID convention
        const materialToTexIdx = new Map();
        const mtlMap = parseMtl(mtlString);
        if (mtlMap.size > 0) {
            for (const [k, v] of buildMaterialToTexMap(mtlMap)) materialToTexIdx.set(k, v);
        }
        if (materialToTexIdx.size === 0) {
            // BB OBJ uses "usemtl m_<texture-uuid>" — match directly
            for (const obj of objContents) {
                for (const line of obj.split('\n')) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('usemtl ')) {
                        const mtlName = trimmed.slice(7).trim();
                        if (materialToTexIdx.has(mtlName)) continue;
                        if (mtlName.startsWith('m_')) {
                            const uuid = mtlName.slice(2);
                            const idx = Texture.all.findIndex(t => t.uuid === uuid);
                            if (idx >= 0) materialToTexIdx.set(mtlName, idx);
                        }
                    }
                }
            }
        }
        let referencedTexIndices = new Set(materialToTexIdx.values());
        // Filter to only user-selected textures
        if (cfg.useAtlas && cfg.atlasTexIndices) {
            const allowed = new Set(cfg.atlasTexIndices);
            referencedTexIndices = new Set([...referencedTexIndices].filter(i => allowed.has(i)));
        }

        const atlasBands = []; // { y0, frameH, frameCount } per animated strip inside the atlas (max 4)
        if (cfg.useAtlas && referencedTexIndices.size > 1) {
            // Multi-texture: build atlas
            const atlas = await buildAtlas([...referencedTexIndices], !!cfg.texAnimEnabled);
            texData = { data: atlas.data, width: atlas.width, height: atlas.height };
            atlasInfo = {
                materialToTexIdx,
                offsets: atlas.offsets,
                width: atlas.width,
                height: atlas.height,
            };
            // Atlas texture animation: one of the atlas textures may itself be a
            // vertical frame strip (h = N*w). Animate just that region; the rest
            // stay static. The strip is stored whole; faces on it UV-map to frame 0
            // (see remapUV) and the shader cycles the sampled row within its band.
            if (cfg.texAnimEnabled) {
                const strips = [...referencedTexIndices].filter(i => {
                    const o = atlas.offsets.get(i);
                    if (!o) return false;
                    const fh = o.uvh;
                    return fh < o.h && o.h % fh === 0;
                });
                if (strips.length === 0) {
                    surfaceWarning('No animated textures selected. Set up texture frames in Blockbench or disable texture animation.');
                } else {
                    if (strips.length > 4)
                        surfaceWarning(`The atlas has ${strips.length} animated textures. Only the first four will animate; export the others separately.`);
                    for (const idx of strips.slice(0, 4)) {
                        const o = atlas.offsets.get(idx);
                        const frameH = o.uvh;
                        const frameCount = o.h / frameH;
                        if (frameCount > 255)
                            throw new Error(`Animated atlas texture has ${frameCount} frames; the maximum is 255.`);
                        // The atlas always stores frames in reverse order, so
                        // image frame 0 (the TOP frame, which the model UV-maps to)
                        // lands at the BOTTOM of the strip region. Encode THAT band;
                        // the shader steps UPWARD (negative row offset) per frame.
                        atlasBands.push({ y0: o.y + o.h - frameH, frameH, frameCount });
                    }
                }
            }
        } else {
            // Single texture (original path)
            const bbTex = Texture.all[cfg.texIndex];
            if (!bbTex) throw new Error(`No texture at index ${cfg.texIndex}`);
            texData = await getTextureRGBA(bbTex);
        }

        const tw = texData.width, th = texData.height;
        if (tw < 8) throw new Error('Minimum texture size is 8px wide');
        // The row-0 header writes the GUI transform into columns 8..15, so a
        // texture narrower than 16px cannot encode it (icon scale/rot/pivot read
        // as 0 -> invisible/wrong inventory icon). The model itself still decodes.
        if (tw < 16) surfaceWarning(`texture is only ${tw}px wide — the inventory (GUI) icon transform needs a ≥16px-wide texture and will be wrong/invisible. Widen the texture if you use the GUI slot.`);
        if (tw > 65535 || th > 65535) throw new Error(`Texture too large: ${tw}x${th} (max 65535)`);

        // Animated textures: a vertically-stacked strip of native or square
        // frames bakes into ntextures stacked texture regions. The header's
        // size.y encodes ONE frame's height (frameH); the shader reserves
        // size.y*ntextures rows and steps the sampled row by texframe*size.y.
        // Native frameCount supports rectangular frames and coarse UV grids.
        // Whole-texture animation (single-texture path): ntextures stacked frame
        // regions. Atlas animation is handled separately above (atlasAnim), so
        // ntextures stays 1 for the atlas — its animated band is a sub-region.
        let ntextures = 1, frameH = th;
        if (cfg.texAnimEnabled && !atlasInfo) {
            frameH = textureFrameHeight(Texture.all[cfg.texIndex], tw, th, true, true);
            const frameCount = th / frameH;
            if (frameCount > 255)
                throw new Error(`Animated texture has ${frameCount} frames; the maximum is 255 (the frame count is stored in a single byte). Use fewer/taller frames.`);
            if (frameCount > 1) { ntextures = frameCount; frameH = th / ntextures; }
        }
        // Texture clock: how many ticks each frame holds (>=1), and whether
        // frames cross-fade (item/GUI only) or hard-step.
        const texFrametime = Math.max(1, Math.round(cfg.texFrametime || 1));
        const texFade = !!cfg.texFade;

        // Armor only: re-center each part's geometry on its own anchor so the
        // calibrated AOFF (measured at BB origin) holds wherever the artist places a
        // part. Item/GUI exports keep their absolute placement (display handles it).
        let faceToPart = null, partRef = null;
        if (cfg.exportAsEquipment && !equipmentOf(cfg)) {
            const f0 = parseObj(objContents[0], 0);
            faceToPart = (Array.isArray(cfg.selectedPieces) && cfg.selectedPieces.length)
                ? buildFaceToPart(f0.faceGroups, f0.faceBlocks) // per-piece: each face -> its part
                : f0.faces.map(() => 0);                        // legacy single-part: whole model as one unit
            partRef = computePartCenters(f0, faceToPart);
        }
        const { data, nfaces, faceGroups, faceBlocks, uvClamped } = buildVertexData(objContents, atlasInfo, partRef, faceToPart);
        const emissiveMap = collectEmissiveMap();
        const faceEmission = faceGroups.map(g => {
            const tk = parseFaceToken(g);                 // each element's emissive is baked into its token
            return tk ? tk.emis : (emissiveMap.get((g || '').toLowerCase()) || 0);
        });
        if (nfaces === 0) throw new Error('No faces found in OBJ');
        const nvertices = nfaces * 4;

        const uvH  = Math.ceil(nfaces / tw);
        const texH = th;
        const vpH  = Math.ceil(data.positions.length * 3 / tw);
        const vtH  = Math.ceil(data.uvs.length * 2 / tw);
        const vH   = Math.ceil(data.vertices.length * 2 / tw); // includes all frames

        // --- Encoder safety guards: fail loudly instead of silently corrupting the PNG ---
        const BYTE24_MAX = 16777215; // u24() holds 0..2^24-1; larger values wrap mod 2^24
        if (!Number.isFinite(cfg.scale))
            throw new Error(`Scale is not a finite number (got ${cfg.scale}).`);
        // No scale UI input; a legacy/corrupt non-positive scale would silently collapse
        // the model. Coerce to 1 (the default) rather than block export with a dead-end.
        if (cfg.scale <= 0) cfg.scale = 1;
        if (!Array.isArray(cfg.offset) || !cfg.offset.every(Number.isFinite))
            throw new Error(`Offset X/Y/Z must be finite numbers (got ${cfg.offset && cfg.offset.join(', ')}).`);
        // Position codec: byte24 = 8388608 + v_world*65536, decodable only in [-128, +128).
        // (Y check includes the -0.5 block-centre re-anchor baked at write time.)
        for (let pi = 0; pi < data.positions.length; pi++) {
            const p = data.positions[pi];
            for (let a = 0; a < 3; a++) {
                const w = p[a] * cfg.scale + cfg.offset[a] - (a === 1 ? 0.5 : 0);
                if (!Number.isFinite(w))
                    throw new Error(`Vertex coordinate became NaN/Infinity — check Scale/Offset.`);
                if (w < -128 || w >= 128)
                    throw new Error(`Model out of range: a vertex reaches ${w.toFixed(2)} on axis ${'XYZ'[a]}; must stay within [-128, 128) after scale+offset. Lower Scale or shrink the model.`);
            }
        }
        // Vertex/UV indices are stored as 24-bit values (u24) — must not exceed the limit.
        if (data.positions.length > BYTE24_MAX)
            throw new Error(`Too many unique positions (${data.positions.length} > ${BYTE24_MAX}) for a 24-bit index — use fewer animation frames or a lower-poly model.`);
        if (data.uvs.length > BYTE24_MAX)
            throw new Error(`Too many unique UVs (${data.uvs.length} > ${BYTE24_MAX}) for a 24-bit index.`);
        // Header packs vpH/vtH as 16-bit (th is already checked above).
        if (vpH > 65535 || vtH > 65535)
            throw new Error(`Encoded data section too tall (positions ${vpH}, uvs ${vtH} rows; max 65535) — use a wider texture or fewer frames.`);

        const headerRows = 2;
        let ty = headerRows + uvH + texH + vpH + vtH + vH;
        if (!cfg.nopow) ty = 1 << Math.ceil(Math.log2(ty || 1));


        const cbArr = ['direct','time','scale','overlay','hurt'];
        const ca = cfg.colorbehavior.map(x => {
            const idx = cbArr.indexOf(x);
            if (idx < 0) throw new Error('Unknown colorbehavior: ' + x);
            return idx;
        });
        const cb  = (ca[0]<<6)|(ca[1]<<3)|ca[2];
        const dur = cfg.duration === 0 ? nframes : cfg.duration;

        const buf = new Uint8Array(tw * ty * 4);
        const put = (x, y, r, g, b, a=255) => {
            // Bounds-check: an out-of-range x must NEVER wrap into the next row.
            // The row-0 header writes columns up to x=15 (GUI block); on a narrow
            // texture those would silently clobber row 1 (the anim clock). Skip
            // instead — callers that need the columns guard tw upstream.
            if (x < 0 || x >= tw || y < 0 || y >= ty) return;
            const i = (y*tw + x)*4;
            buf[i]=r&255; buf[i+1]=g&255; buf[i+2]=b&255; buf[i+3]=a&255;
        };
        // 16-bit quantizer for every GUI field (display-1:1 step B: scale/trans/
        // rot/pivot all q16 now). Every header pixel must keep A=255 to survive
        // MC's alpha pre-multiplication on GUI item-icon rendering, so only RGB
        // (3 bytes) per pixel carry data; 2 bytes/axis -> 2 pixels per xyz triple.
        // Returns [highByte, lowByte]; A is locked at 255 by the put() callers.
        const q16 = (v, min, max) => {
            const c = Math.max(min, Math.min(max, v));
            const u = Math.round((c - min) / (max - min) * 65535);
            return [(u >> 8) & 255, u & 255];
        };

        // GUI shader parameters at q16 (display-1:1 step B). Each axis is 2 bytes
        // (high,low); scale 0..4, translation -128..+128 (1/16-block, vanilla),
        // rotation 0..360°, pivot -128..+128 (model origin). q16 epsilon:
        // scale 6.1e-5, trans/pivot 3.9e-3, rot 5.5e-3° — far below vanilla need.
        const guiSlot = (cfg.displaySlots && cfg.displaySlots.gui) || {};
        const fallback = (v, def) => Number.isFinite(v) ? v : def;
        // GUI scale 0 (or NaN/blank) is never legitimate — it makes the icon invisible.
        // Treat any non-positive or non-finite value as 1 (identity scale).
        const guiS = (guiSlot.scale || [1,1,1]).map(v => (Number.isFinite(v) && v > 0) ? v : 1);
        const guiT = (guiSlot.translation || [0,0,0]).map(v => fallback(v, 0));
        const guiR = (guiSlot.rotation    || [0,0,0]).map(v => {
            const d = fallback(v, 0);
            return ((d % 360) + 360) % 360;
        });
        // GUI rotation pivot defaults to the BLOCK CENTRE — which in the decoded
        // frame is the ORIGIN [0,0,0] (the decoded model is block-centre relative;
        // in-game verified via the lift-0 hand/world slots matching vanilla). That
        // is the pivot vanilla display uses, so a rotated GUI icon lands where the
        // same vanilla model's icon does. (The old default was the model's bbox
        // centre — "visually centred" but off vanilla under rotation/scale.)
        // A user-set pivot still overrides, e.g. to rotate about the model centre.
        const offArr = Array.isArray(cfg.offset) ? cfg.offset : [0,0,0];
        const userPivot = guiSlot.pivot || [0,0,0];
        const hasUserPivot = userPivot.some(v => v !== 0);
        const guiP = hasUserPivot
            ? userPivot.map((v, i) => v * (+cfg.scale || 1) + (+offArr[i] || 0))
            : [0, 0, 0];
        const staticDisplay = hasStaticWorldDisplay(cfg);
        const [sxH, sxL] = q16(guiS[0], 0, 4),    [syH, syL] = q16(guiS[1], 0, 4),    [szH, szL] = q16(guiS[2], 0, 4);
        const [txH, txL] = q16(guiT[0], -128, 128), [tyH, tyL] = q16(guiT[1], -128, 128), [tzH, tzL] = q16(guiT[2], -128, 128);
        const [rxH, rxL] = q16(guiR[0], 0, 360),  [ryH, ryL] = q16(guiR[1], 0, 360),  [rzH, rzL] = q16(guiR[2], 0, 360);
        // q16 silently clamps to [-128,128); a large/offset model can push the GUI
        // rotation pivot past that, shifting the icon's rotation centre — warn first.
        if (guiP.some(v => v < -128 || v >= 128))
            surfaceWarning(`GUI rotation pivot (${guiP.map(v => v.toFixed(1)).join(', ')}) is outside [-128, 128) and was clamped — the inventory icon will spin about a shifted point. Lower Scale or move the model toward the origin.`);
        const [pxH, pxL] = q16(guiP[0], -128, 128);
        const [pyH, pyL] = q16(guiP[1], -128, 128);
        const [pzH, pzL] = q16(guiP[2], -128, 128);

        // Row 0 — header. marker.a=255 (alpha=255 prevents GUI alpha-premultiplication
        // from corrupting RGB; legacy marker.a=78 broke GUI rendering for this reason).
        put(0, 0, 12, 34, 56, 255);
        put(1, 0, Math.trunc(tw/256), tw%256, Math.trunc(frameH/256), 255);
        put(2, 0, Math.trunc(nvertices/16777216)%256, Math.trunc(nvertices/65536)%256,
                  Math.trunc(nvertices/256)%256, 255);
        put(3, 0, Math.trunc(nframes/65536)%256, Math.trunc(nframes/256)%256,
                  nframes%256, ntextures);
        // t[4].a bits: 7=version(1), 6=autoplay, 5..4=easing low 2 bits,
        //   3..2=interpolation (legacy, shader-dead), 1..0=easing high 2 bits.
        // Easing is a 4-bit per-ANIMATION index (0..15) split across the two free
        // regions of this byte. The high bits live in 1..0, which older encoders
        // ALWAYS wrote 0 — so any legacy PNG (easing 0..3) decodes byte-identically
        // under the new 4-bit reader. Per-frame easing was rejected: the per-vertex
        // frame data has no spare bits without a format break.
        put(4, 0, Math.trunc(dur/65536)%256, Math.trunc(dur/256)%256, dur%256,
                  128|(cfg.autoplay?64:0)|((cfg.easing&3)<<4)|((cfg.interpolation&3)<<2)|((cfg.easing>>2)&3));
        put(5, 0, Math.trunc(vpH/256)%256, vpH%256, Math.trunc(vtH/256)%256, 255);
        // t[6].r bits: 7=noshadow, 6..5=autorotate, 4..2=visibility,
        //   1=hasStaticDisplay (step A1 gate), 0=colorbehavior high bit.
        // t[6].b = GUI header version (display-1:1 step B): 2 = q16 GUI layout in
        // t[8..15]. The shader gates its GUI decode on this so a stale PNG (older
        // encoder wrote 255 here) cannot desync from the q16 decode. A stays 255.
        put(6, 0,
            ((cfg.noshadow?1:0)<<7)|(cfg.autorotate<<5)|(cfg.visibility<<2)|((staticDisplay?1:0)<<1)|Math.trunc(cb/256),
            cb%256, 2, 255);
        put(7, 0, frameH%256, nvertices%256, vtH%256, 255);
        // GUI shader meta at q16 (display-1:1 step B): 8 pixels, 2 bytes/axis
        // (high,low) for scale/trans/rot/pivot. All A=255 for premultiplication
        // safety. Layout MUST match the shader decode (objmc_main.glsl GUI block):
        //   t[8]=(sxH,sxL,syH) t[9]=(syL,szH,szL)  scale  0..4
        //   t[10]=(txH,txL,tyH) t[11]=(tyL,tzH,tzL) trans -128..128 (1/16-block)
        //   t[12]=(rxH,rxL,ryH) t[13]=(ryL,rzH,rzL) rot   0..360 deg
        //   t[14]=(pxH,pxL,pyH) t[15]=(pyL,pzH,pzL) pivot -128..128 (origin)
        put(8,  0, sxH, sxL, syH, 255);
        put(9,  0, syL, szH, szL, 255);
        put(10, 0, txH, txL, tyH, 255);
        put(11, 0, tyL, tzH, tzL, 255);
        put(12, 0, rxH, rxL, ryH, 255);
        put(13, 0, ryL, rzH, rzL, 255);
        put(14, 0, pxH, pxL, pyH, 255);
        put(15, 0, pyL, pzH, pzL, 255);
        // Row 1: hand rotation/translation writes removed (step A2 revert) —
        // vanilla model.json owns the full hand transform now. Row 1 stays
        // zeroed except the issue-#9 texture clock below.
        for (let i = 0; i < tw; i++) put(i, 1, 0, 0, 0, 255);  // init with zeros
        // Texture-animation clock (issue #9), stored in previously-zeroed row-1
        // pixels. x=4 RGB = texFrametime (24-bit ticks per frame); x=5.r = fade
        // flag. The shader fetches these from row 1 via texelFetch(topleft+(x,1)).
        // Only written when ntextures>1 so a non-animated export stays byte-for-
        // byte identical to the pre-#9 encoder (these pixels remain zeroed).
        // Row-1 layout (v3):
        //   x=0..3           — dynamic slot-marker entries for ids 1..4:
        //                      (SzH, SzL, flags). Sz at q16 over 0..4, 0 = no
        //                      Z override; flags bit0 = dropped/shelf lift,
        //                      bit1 = first-person hand context.
        //   x=4 RGB          — texture-animation frametime (24-bit ticks/frame)
        //   x=5              — r = fade(bit0) | dynCount(bits1..4),
        //                      g = atlas band COUNT, b = marker version (2 = v3)
        //   x=6+2i, 7+2i     — atlas band i: (y0H, y0L, fHH) / (fHL, frames, -)
        //   x=6+2B + (id-5)  — dynamic entries for ids 5..8 (B = band count)
        // Capacity is bounded by the texture width; bands are trimmed to fit.
        const { dynamics } = assignSlotMarkers(buildDisplayTransforms(cfg));
        const extraDyn = Math.max(0, dynamics.length - 4);
        const requiredWidth = 6 + extraDyn;
        if (tw < requiredWidth) throw new Error(`Texture must be at least ${requiredWidth}px wide for ${dynamics.length} display contexts. Widen the texture and re-export.`);
        const maxBands = Math.min(15, Math.floor((tw - 6 - extraDyn) / 2));
        if (atlasBands.length > maxBands) {
            surfaceWarning(`Only ${maxBands} textures can animate at a width of ${tw}px. ${atlasBands.length - maxBands} will stay static. Increase the texture width to animate more.`);
            atlasBands.length = Math.max(0, maxBands);
        }
        const texAnimActive = ntextures > 1 || atlasBands.length > 0;
        if (texAnimActive) {
            put(4, 1, Math.trunc(texFrametime/65536)%256, Math.trunc(texFrametime/256)%256,
                      texFrametime%256, 255);
        }
        put(5, 1, ((texAnimActive && texFade) ? 1 : 0) | (dynamics.length << 1),
                  atlasBands.length, 2, 255);
        for (const [i, b] of atlasBands.entries()) {
            put(6 + 2*i, 1, Math.trunc(b.y0/256)%256, b.y0%256, Math.trunc(b.frameH/256)%256, 255);
            put(7 + 2*i, 1, b.frameH%256, b.frameCount%256, 0, 255);
        }
        // Dynamic slot markers (see assignSlotMarkers): per-slot exact display
        // Z scale + lift flag, addressed by the marker id baked into that
        // slot's carrier UV midpoints. Ids 1..4 at x=0..3; 5..8 after the bands.
        {
            const q16s = (v) => {
                const c = Math.max(0, Math.min(4, v));
                const u = Math.round(c / 4 * 65535);
                return [(u >> 8) & 255, u & 255];
            };
            for (const [i, d] of dynamics.entries()) {
                const [hi, lo] = q16s(d.sz);
                const x = i < 4 ? i : 6 + 2*atlasBands.length + (i - 4);
                put(x, 1, hi, lo, (d.lift ? 1 : 0) | (d.hand ? 2 : 0), 255);
            }
        }

        // UV header + JSON elements
        const elements = [];
        for (let i = 0; i < nfaces; i++) {
            const px = i%tw, py = Math.floor(i/tw)+headerRows;
            put(px, py, Math.trunc(px/256)%256, px%256, Math.trunc(py/256)%256, py%256);
            const elem = {
                // Carrier anchor = FaceBakery NORTH c2 = MIN corner = (8,8,8) px = block
                // centre (0.5,0.5,0.5). The shader anchors the centred decoded model AT c2,
                // so c2 must be the cube CENTRE, not the cube bottom. Was [8,0,8] (MIN_Y=0 =
                // bottom) which dropped every model 0.5 block (8px) low — verified by
                // tools/render-tester (IoU 0.47 -> 0.998 after this shift). +Y edge stays
                // 16px (8..24) so display scale/rotation reconstruction is unchanged.
                from: [8,8,8], to: [24,24,8],
                faces: { north: {
                    uv: [(px+0.1)*16/tw,(py+0.1)*16/ty,(px+0.9)*16/tw,(py+0.9)*16/ty],
                    texture: '#0', tintindex: 0,
                }},
            };
            if (faceEmission[i] > 0) elem.light_emission = faceEmission[i];
            elements.push(elem);
        }

        // Texture rows
        if (atlasInfo) {
            // Atlas frame 0 is at the bottom of its region, regardless of Flip
            // UV. Reverse frame order, then flip only the rows WITHIN each frame.
            for (const [, off] of atlasInfo.offsets) {
                for (let ly = 0; ly < off.h; ly++) {
                    const fh = off.uvh;
                    const frameBase = off.h - fh - Math.floor(ly / fh) * fh;
                    const row = ly % fh;
                    const srcLy = frameBase + (cfg.flipuv ? row : (fh - 1 - row));
                    const srcRow = off.y + srcLy;
                    const dstRow = (headerRows + uvH) + off.y + ly;
                    for (let px = 0; px < off.w; px++) {
                        const si = (srcRow * tw + px) * 4;
                        put(px, dstRow, texData.data[si], texData.data[si+1],
                            texData.data[si+2], texData.data[si+3]);
                    }
                }
            }
        } else if (ntextures > 1) {
            // Animated strip: flip each frame region INDEPENDENTLY so frame
            // ORDER is preserved (a whole-strip flip would reverse the order).
            // The full strip stays physically stored as frameH*ntextures rows.
            for (let f = 0; f < ntextures; f++) {
                const fbase = f * frameH; // top row of this frame in src & dst
                for (let ly = 0; ly < frameH; ly++) {
                    const srcY = fbase + (cfg.flipuv ? ly : (frameH-1-ly));
                    const dstY = (headerRows+uvH) + fbase + ly;
                    for (let px = 0; px < tw; px++) {
                        const si = (srcY*tw+px)*4;
                        put(px, dstY, texData.data[si], texData.data[si+1],
                            texData.data[si+2], texData.data[si+3]);
                    }
                }
            }
        } else {
            // Single texture: global flip
            for (let py = 0; py < th; py++) {
                const srcY = cfg.flipuv ? py : (th-1-py);
                for (let px = 0; px < tw; px++) {
                    const si = (srcY*tw+px)*4;
                    put(px, (headerRows+uvH)+py, texData.data[si], texData.data[si+1],
                        texData.data[si+2], texData.data[si+3]);
                }
            }
        }

        // Position data
        let ybase = headerRows+uvH+texH;
        // VERTICAL ORIGIN CONVENTION: the decoded frame is BLOCK-CENTRE relative
        // (the carrier anchor c2 sits at the block centre and every display path
        // adds decoded positions to it as-is). Blockbench models are naturally
        // built ON the grid floor (y=0 = block bottom, like a vanilla JSON model
        // 0..16), so bake Y - 0.5 here — then the model lands in game exactly
        // where it stands relative to the BB grid, in EVERY context (GUI, hands,
        // frames, ground) at once. Without this, a floor-built model rides half
        // a block high everywhere (a centre-built model used to hide it, which
        // is how the old per-slot lifts got mis-calibrated per model).
        // Applied to ALL exports, equipment included, so the ITEM view of an
        // armor export is correct in EVERY display slot (an element-shift
        // compensation only worked at identity display — the shifted anchor
        // rotates with the display). The armor shader path adds the +0.5 back in
        // the SAME decoded model frame (before its part re-anchoring/rotation),
        // so armor on entities is byte-equivalent to the pre-convention state.
        const bakeOffset = [cfg.offset[0], cfg.offset[1] - 0.5, cfg.offset[2]];
        for (let i = 0; i < data.positions.length; i++) {
            for (const [j, pxArr] of posPixels(data.positions[i], cfg.scale, bakeOffset).entries()) {
                const p = i*3+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // UV data
        ybase += vpH;
        if (uvClamped || data.uvs.some(uv => uv.some(v => v < -1e-6 || v > 1 + 1e-6)))
            surfaceWarning('Some UVs are outside the texture frame. Move them inside the frame to avoid stretched or incorrect textures.');
        for (let i = 0; i < data.uvs.length; i++) {
            for (const [j, pxArr] of uvPixels(data.uvs[i]).entries()) {
                const p = i*2+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // Vertex data (all frames)
        ybase += vtH;
        for (let i = 0; i < data.vertices.length; i++) {
            const pixels = vertPixels(data.vertices[i]);
            for (const [j, pxArr] of pixels.entries()) {
                const p = i*2+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // Round-trip verification: decode a few entries from the buffer
        // using the same logic the shader uses, and compare with source data.
        const verifyWarns = [];
        try {
            const rd = (x, y) => {
                const i = (y*tw+x)*4;
                return [buf[i], buf[i+1], buf[i+2], buf[i+3]];
            };
            // Layout diagnostic
            console.log('[obj3-layout] headerRows='+headerRows, 'uvH='+uvH, 'texH='+texH,
                'vpH='+vpH, 'vtH='+vtH, 'vH='+vH, 'ty='+ty, 'tw='+tw);
            console.log('[obj3-layout] row0[0]=', rd(0,0), 'row1[0]=', rd(0,1),
                'uvStart[0]=', rd(0,headerRows), 'posStart[0]=', rd(0,headerRows+uvH+texH));
            // Verify marker
            const mk = rd(0, 0);
            if (mk[0]!==12||mk[1]!==34||mk[2]!==56||mk[3]!==255) {
                verifyWarns.push('marker mismatch');
                console.error('[obj3-verify] MARKER MISMATCH:', mk);
            }
            // Verify header: nvertices, nframes
            const h2 = rd(2, 0), h7 = rd(7, 0);
            const decNv = h2[0]*16777216+h2[1]*65536+h2[2]*256+h7[1];
            const h3 = rd(3, 0);
            const decNf = Math.max(h3[0]*65536+h3[1]*256+h3[2], 1);
            if (decNv !== nvertices) { verifyWarns.push('nvertices mismatch'); console.error(`[obj3-verify] nvertices: encoded=${decNv} expected=${nvertices}`); }
            if (decNf !== nframes)   { verifyWarns.push('nframes mismatch');   console.error(`[obj3-verify] nframes: encoded=${decNf} expected=${nframes}`); }
            // Verify first position (shader decodes as v*scale+offset)
            const posBase = headerRows + uvH + texH;
            const px0 = rd(0, posBase), px1 = rd(1, posBase), px2 = rd(2, posBase);
            const decPos = [
                (px0[0]/255*256 + px0[1]/255 + px0[2]/255/256) * (255/256) - 128,
                (px1[0]/255*256 + px1[1]/255 + px1[2]/255/256) * (255/256) - 128,
                (px2[0]/255*256 + px2[1]/255 + px2[2]/255/256) * (255/256) - 128,
            ];
            const srcPos = data.positions[0];
            // Expected = what the encoder actually baked (incl. the -0.5 Y
            // block-centre re-anchor for non-armor exports).
            const expPos = srcPos.map((v,j) => v * cfg.scale + bakeOffset[j]);
            const posDiff = Math.abs(decPos[0]-expPos[0])+Math.abs(decPos[1]-expPos[1])+Math.abs(decPos[2]-expPos[2]);
            if (posDiff > 0.01) { verifyWarns.push('pos[0] mismatch'); console.error(`[obj3-verify] pos[0] MISMATCH: exp=[${expPos.map(v=>v.toFixed(4))}] dec=[${decPos.map(v=>v.toFixed(4))}]`); }
            // Verify first UV coordinate (uvPixels writes u24(clamp(v)*65535) at the
            // UV-float section base; mirror the encoder's write base + the shader's
            // /65535 read). Catches a regression in the clamp / scaling math.
            const uvBase = headerRows + uvH + texH + vpH;
            const uv0u = rd(0, uvBase), uv0v = rd(1, uvBase);
            const decUv = [
                (uv0u[0]*65536 + uv0u[1]*256 + uv0u[2]) / 65535,
                (uv0v[0]*65536 + uv0v[1]*256 + uv0v[2]) / 65535,
            ];
            const srcUv = data.uvs[0];
            if (srcUv) {
                const expUv = srcUv.map(v => Math.max(0, Math.min(1, v)));
                const uvEps = 2/65535;
                if (Math.abs(decUv[0]-expUv[0]) > uvEps || Math.abs(decUv[1]-expUv[1]) > uvEps) {
                    verifyWarns.push('uv[0] value mismatch');
                    console.error(`[obj3-verify] uv[0] MISMATCH: exp=[${expUv.map(v=>v.toFixed(5))}] dec=[${decUv.map(v=>v.toFixed(5))}]`);
                }
            }
            // Verify first vertex data entry
            const vtxBase = headerRows + uvH + texH + vpH + vtH;
            const va = rd(0, vtxBase), vb = rd(1, vtxBase);
            const decPi = va[0]*65536+va[1]*256+va[2];
            const decUi = vb[0]*65536+vb[1]*256+vb[2];
            const srcVert = data.vertices[0];
            if (decPi !== srcVert[0]) { verifyWarns.push('vert[0].pos mismatch'); console.error(`[obj3-verify] vert[0].pos: encoded=${decPi} expected=${srcVert[0]}`); }
            if (decUi !== srcVert[1]) { verifyWarns.push('vert[0].uv mismatch');  console.error(`[obj3-verify] vert[0].uv: encoded=${decUi} expected=${srcVert[1]}`); }
            // Verify last frame's first vertex
            if (nframes > 1) {
                const lastIdx = (nframes-1) * nvertices;
                const lp = lastIdx * 2;
                const la = rd(lp%tw, vtxBase+Math.floor(lp/tw));
                const decLPi = la[0]*65536+la[1]*256+la[2];
                const srcLast = data.vertices[lastIdx];
                if (srcLast) {
                    if (decLPi !== srcLast[0]) { verifyWarns.push('last frame mismatch'); console.error(`[obj3-verify] vert[${lastIdx}].pos: enc=${decLPi} exp=${srcLast[0]}`); }
                }
            }
        } catch(e) { verifyWarns.push('verify error'); console.error('[obj3-verify] error:', e.message); }

        // Block a corrupt export: any hard integrity mismatch (marker / counts /
        // position / vertex data) means the shader would decode garbage, so abort
        // visibly instead of writing a broken PNG. ('verify error' = an exception
        // inside the verifier itself, kept as a soft warning.)
        const hardFails = verifyWarns.filter(w => w !== 'verify error');
        if (hardFails.length) {
            throw new Error('Integrity check failed (' + hardFails.join('; ') + ') — export aborted to avoid a corrupt model; see console for details.');
        }

        const pngBuffer = encodePNG(tw, ty, buf);
        const warnStr = verifyWarns.length
            ? t('warn_suffix').replace('{n}', verifyWarns.length).replace('{w}', tPlural(verifyWarns.length, 'warnings'))
            : '';
        const debugInfo = `${nfaces} ${tPlural(nfaces, 'faces')} · ${nframes} ${tPlural(nframes, 'frames')} · ${tw}×${ty}px` + warnStr;

        return { pngBuffer, rawBuf: buf, elements, nfaces, nvertices, nframes, tw, ty, debugInfo, faceGroups, faceBlocks, faceToPart, faceEmission, faceToEquipmentBinding: buildFaceEquipmentBindings(faceGroups,cfg) };
    }

    // =========================================================
    // Section 9: Export Orchestration
    // =========================================================

    // Get OBJ contents (static or animated).
    // If the user has the BB Display tab open, Codecs.obj.compile() would apply
    // that slot's transforms (scale/rotation) to the exported geometry. The same
    // trap exists for the ANIMATE tab: with an animation selected and the
    // Timeline scrubbed, the scene is POSED and a static export bakes that pose
    // (group keyframe transforms ride BB's OBJ compiler) — the whole model
    // exported shifted until the user happened to leave Animate mode.
    // Switch to Edit mode first to ensure unaffected rest-pose geometry.
    // (The ANIMATED branch is exempt: it drives Timeline/Animator.preview()
    // itself per frame and restores the scene in its own finally.)
    async function getObjContents(cfg, onProgress) {
        const prevMode  = typeof Mode !== 'undefined' && Mode.selected;
        const inDisplay = prevMode && prevMode.id === 'display';
        const inAnimate = prevMode && prevMode.id === 'animate' && !cfg.animationEnabled;
        if ((inDisplay || inAnimate) && Modes && Modes.options && Modes.options.edit) {
            Modes.options.edit.select();
            // Leaving Display mode restores the scene LAZILY: right after
            // select() the meshes' matrixWorld still carries the display-slot
            // transform, and Codecs.obj.compile() reads matrixWorld — an export
            // from the Display tab baked the model shifted/rotated (in-game
            // "опущенные модели": verified 2026-07-10, cube sank 0.5 block with
            // a rotation residue). Yield a tick for BB's exit hooks, then force
            // a world-matrix refresh so the codec sees rest-pose geometry.
            await new Promise(r => setTimeout(r, 0));
            try {
                if (typeof scene !== 'undefined' && scene && scene.updateMatrixWorld) {
                    scene.updateMatrixWorld(true);
                }
            } catch (e) {}
        }
        // Give every element its own emission/part token during OBJ compilation.
        // Ordinary duplicate names (e.g. "cube") must not share their light level;
        // codec emit order can also differ from the Outliner traversal. The same
        // tokens work for static/animated items and armor. Restored in finally.
        const restoreNames = applyPartTokenNames();
        try {
            if (cfg.animationEnabled) {
                const anim = Animation.all[cfg.animationIndex];
                if (!anim) throw new Error('Animation not found');
                return await compileAnimatedObjFrames(anim, {
                    fps:        cfg.animFps,
                    frameStart: cfg.animStart,
                    frameEnd:   cfg.animEnd > 0 ? cfg.animEnd : anim.length,
                    filterArmature: cfg.filterArmature,
                    cameraConfig: cfg.exportCameras ? cfg : null,
                    onProgress,
                });
            } else {
                const compile = () => Codecs.obj.compile();
                const safeCompile = () => withNonGeoHidden(compile);
                const boneUUIDs = collectBoneUUIDs();
                const hasArm = boneUUIDs.size > 0;
                const c = hasArm ? await withArmatureHidden(safeCompile) : await safeCompile();
                const raw = typeof c === 'string' ? c : (c.obj || '');
                const mtl = (typeof c === 'object' && c.mtl) ? c.mtl : '';
                if (!raw) throw new Error('OBJ codec returned empty content');
                let s = raw;
                if (hasArm) {
                    s = filterObjBones(s, boneUUIDs);
                }
                return { objs: [s], mtl };
            }
        } finally {
            if (restoreNames) restoreNames();
            if (inDisplay && Modes && Modes.options && Modes.options.display) {
                Modes.options.display.select();
            }
            if (inAnimate && Modes && Modes.options && Modes.options.animate) {
                try { Modes.options.animate.select(); } catch (e) {}
            }
        }
    }

    // Main export entry point
    async function runExport(cfg, onStatus) {
        if (cfg.exportCameras && (!cfg.animationEnabled || !cfg.generateDatapack || cfg.exportAsEquipment || cfg.datapackTargetType !== 'item_display'))
            throw new Error(t('err_camera_target'));
        const displayTransforms = buildDisplayTransforms(cfg);

        onStatus(t('status_building'));
        const { objs, mtl, cameras } = await getObjContents(cfg, (i, n) =>
            onStatus(t('status_baking').replace('{i}', i).replace('{n}', n))
        );
        const result = await buildOutput(cfg, objs, mtl);
        result.cameras = cameras;
        if (cameras?.some(c => c.unsupported)) surfaceWarning(t('warn_camera_channels'));
        onStatus(t('status_choose_location').replace('{info}', result.debugInfo));
        await saveSingleOutput(result, displayTransforms, cfg);
        onStatus(t('export_done').replace('{info}', result.debugInfo));
    }

    // =========================================================
    // Section 10: File Saving
    // =========================================================
    // Display contexts Minecraft items use, in the order we emit them.
    // Each gets its own model.json with per-slot placeholder calibration
    // (empirically determined via debug-mode measurements vs vanilla JSON
    // cube reference).
    const DISPLAY_SLOTS = [
        'thirdperson_righthand', 'thirdperson_lefthand',
        'firstperson_righthand', 'firstperson_lefthand',
        'head', 'gui', 'ground', 'fixed', 'on_shelf',
    ];
    // Single source of truth for the export namespace. All exported assets live
    // under assets/<EXPORT_NS>/ and are referenced as <EXPORT_NS>:item/<name>.
    const EXPORT_NS = 'objcubed';
    // Per-slot placeholder calibration. Adjusts the `from`/`to` of every
    // element by these BB-unit deltas. Values measured against a reference
    // vanilla JSON cube placed at the same OBJ coordinates.
    const SLOT_OFFSETS = {
        thirdperson_righthand: { x: 0, y: 0,  z: 0 },
        thirdperson_lefthand:  { x: 0, y: 0,  z: 0 },
        firstperson_righthand: { x: 0, y: 0,   z: 0  },
        firstperson_lefthand:  { x: 0, y: 0,   z: 0  },
        head:                  { x: 0, y: 0,   z: 0  },
        gui:                   { x: 0, y: 0, z: 0 },
        // ground/on_shelf: +8 raises the carrier elements (and thus the anchor c2)
        // half a block. In-game: with everything else vanilla-exact at lift 0,
        // dropped items still sat half a block LOW — the dropped-item pipeline
        // positions the model half a block higher than the held/framed one.
        // The shift rides the carrier bake, so it holds under any display R*S.
        ground:                { x: 0, y: 8,  z: 0 },
        fixed:                 { x: 0, y: 0,  z: 0 },
        on_shelf:              { x: 0, y: 8, z: 0 },
    };

    // ── SLOT MARKERS v3 ─────────────────────────────────────────────────────
    // Each per-slot model.json bakes a SLOT ID into the U MIDPOINT of its
    // carrier face UVs: midpoint = px + 0.5 + id*0.035 (U span 0.4 texel). The
    // midpoint survives MC's anti-bleed UV shrink (it contracts UVs
    // SYMMETRICALLY toward the quad centre), and the shader recovers the id
    // via fract of the subgroup quad's U midpoint. Ids:
    //   0     — neutral (midpoint px+0.5 = the plain 0.1/0.9 margins; no
    //           marker rewrite needed): no lift, Z display scale falls back
    //           to min(Sx, Sy) (exact for uniform / X- or Y-only scales).
    //   1..8  — DYNAMIC, one per hand slot or slot needing a lift/distinct Z
    //           display scale (there are exactly 8 non-GUI slots, so this
    //           covers every slot). Each id owns a row-1 table pixel carrying
    //           (SzH, SzL, flags): Sz at q16 over 0..4 with 0 = "no override,
    //           use min(Sx,Sy)"; bit1 = first-person context; bit0 = dropped/shelf
    //           lift (their pipeline rides half a block higher; model.json
    //           translation Y is clamped by MC and the +8 element offset is
    //           capped by the format). Table pixels: ids 1..4 at x=0..3, ids
    //           5..8 AFTER the atlas bands at x = 6 + 2*bandCount + (id-5).
    // Row-1 x=5.b: 1 = v2 scales/lifts, 2 = v3 explicit hand context.
    // Legacy exports with version 0 keep the old single
    // 0.65-midpoint rule in the shader.
    const SLOT_MARKER = { NEUTRAL: 0, DYN_MIN: 1, DYN_MAX: 8 };
    const slotMarkerMid = (id) => 0.5 + id * 0.035;
    function calibratedElementsForSlot(baseElements, slot, markerId) {
        const off = SLOT_OFFSETS[slot] || { x: 0, y: 0, z: 0 };
        const id = markerId || 0;
        if (off.x === 0 && off.y === 0 && off.z === 0 && id === 0) return baseElements;
        // Rewrite the U range to span 0.4 texel about the id's midpoint
        // (px + 0.5 + id*0.04). Stays inside the face-id texel, so decoding
        // is unaffected. (u1-u0) spans 0.8 texel -> one texel = (u1-u0)/0.8.
        const markUv = ([u0, v0, u1, v1]) => {
            const texel = (u1 - u0) / 0.8;
            const base = u0 - 0.1 * texel;                 // texel left edge (px)
            const mid = base + slotMarkerMid(id) * texel;
            return [mid - 0.2 * texel, v0, mid + 0.2 * texel, v1];
        };
        return baseElements.map(el => ({
            ...el,
            from: [el.from[0] + off.x, el.from[1] + off.y, el.from[2] + off.z],
            to:   [el.to[0]   + off.x, el.to[1]   + off.y, el.to[2]   + off.z],
            ...(id !== 0 ? {
                faces: Object.fromEntries(Object.entries(el.faces).map(
                    ([dir, f]) => [dir, { ...f, uv: markUv(f.uv) }])),
            } : {}),
        }));
    }

    // Assign v3 marker ids for this export from its display transforms.
    // Returns { ids: Map<slot, id>, dynamics: [{slot, sz, lift, hand}] } — dynamics
    // are written into the PNG row-1 table by buildOutput (sz 0 = "no Z
    // override"). Every slot needing a lift and/or a distinct Z scale gets an
    // entry. First-person slots always get an entry, even at identity: 26.3
    // gives hands and world geometry the same near/far projection, so context
    // must travel explicitly with the selected carrier. There are 8 non-GUI
    // slots and 8 ids, so nothing ever overflows.
    function assignSlotMarkers(displayTransforms) {
        const ids = new Map();
        const dynamics = [];
        const zOverride = (d) => {
            if (!d || !d.scale) return 0;
            const s = d.scale;
            return Math.abs(s[2] - Math.min(s[0], s[1])) > 1e-4 ? s[2] : 0;
        };
        for (const slot of DISPLAY_SLOTS) {
            if (slot === 'gui') continue;                  // GUI scale is header-exact already
            const lift = (slot === 'ground' || slot === 'on_shelf');
            const hand = slot === 'firstperson_righthand' || slot === 'firstperson_lefthand';
            const sz = zOverride(displayTransforms[slot]);
            if (lift || hand || sz !== 0) {
                dynamics.push({ slot, sz, lift, hand });
                ids.set(slot, SLOT_MARKER.DYN_MIN + dynamics.length - 1);
            } else {
                ids.set(slot, SLOT_MARKER.NEUTRAL);
            }
        }
        return { ids, dynamics };
    }

    // Build the display_context-keyed model node for one modelBaseName. This is
    // the per-model body that becomes a single custom_model_data case below.
    // Every exported slot gets its own case; contexts without one fall back to
    // the NEUTRAL `<name>_default` json (marker id 0) — never to a slot json,
    // whose v2 slot marker would leak that slot's Z scale into other contexts.
    function buildDisplayContextModel(modelBaseName, exportedSlots) {
        const tints = [{ type: 'minecraft:potion', default: -1 }];
        const ref = slot => `${EXPORT_NS}:item/${modelBaseName}_${slot}`;
        const cases = (exportedSlots || DISPLAY_SLOTS)
            .map(slot => ({
                when: slot,
                model: { type: 'minecraft:model', model: ref(slot), tints },
            }));
        const fallbackModel = {
            type: 'minecraft:model',
            model: ref('default'),
            tints,
        };
        if (cases.length === 0) return fallbackModel;
        return {
            type: 'minecraft:select',
            property: 'minecraft:display_context',
            cases,
            fallback: fallbackModel,
        };
    }

    // Item definition (assets/minecraft/items/<baseItem>.json). Mirrors the
    // shipped pack shape: an OUTER minecraft:select on custom_model_data keyed
    // by modelBaseName, with a vanilla fallback. A second model on the same
    // baseItem coexists by adding another custom_model_data case (see merge in
    // saveSingleOutput).
    function buildItemSelector(modelBaseName, exportedSlots, baseItem) {
        const base = baseItem || 'iron_ingot';
        return {
            // MANDATORY: default `true` makes Minecraft replay the item-swap
            // animation every time obj³ mutates the item's components per
            // animation frame, breaking the hand animation. Must be false.
            hand_animation_on_swap: false,
            model: {
                type: 'minecraft:select',
                property: 'minecraft:custom_model_data',
                index: 0,
                cases: [
                    { when: modelBaseName, model: buildDisplayContextModel(modelBaseName, exportedSlots) },
                ],
                fallback: { type: 'minecraft:model', model: `minecraft:item/${base}` },
            },
        };
    }

    // Identity transform — explicit override to prevent Minecraft's inferred
    // defaults for slots the user hasn't customised (notably GUI which would
    // otherwise inherit block/block rotation [30, 225, 0]).
    //
    // Single source of truth for display values:
    //   - Slots exposed in the Vue dialog (third/left/head/ground/fixed) get
    //     their values from buildDisplayTransforms which reads Vue defaults
    //     + native BB Display editor.
    //   - Slots NOT in the dialog (gui, firstperson, on_shelf) get IDENTITY
    //     here as a safety net so Minecraft's inferred block defaults
    //     (rotation [30,225,0], scale [0.625]) don't sneak in.
    //
    // KNOWN MINECRAFT QUIRK: for `ground` and `on_shelf` contexts the
    // engine clamps the Y component of display.translation (dropped items
    // are physically locked to the ground; shelf items to the surface).
    // X and Z still work. Y simply can't be calibrated for these slots.
    const IDENTITY_DISPLAY = { rotation: [0,0,0], translation: [0,0,0], scale: [1,1,1] };

    function pickDirectory(title, startpath) {
        return Blockbench.pickDirectory({ title, startpath: startpath || undefined });
    }

    // Build the per-slot model JSON string. Minified (no whitespace) since this
    // is the heavy full-geometry file. textures carries both 0 and particle so
    // Minecraft has break/landing particles instead of missing-texture.
    function buildSlotModelJson(pngName, slot, slotDisplay, elements, textureResource) {
        const model = {
            textures: { 0: textureResource || `${EXPORT_NS}:item/${pngName}`, particle: textureResource || `${EXPORT_NS}:item/${pngName}` },
            elements: elements,
            display:  slotDisplay,
        };
        return JSON.stringify(model);
    }

    // Does an existing parsed item definition match the shape buildItemSelector
    // produces (outer custom_model_data select)? Only then is it safe to merge a
    // new case in; anything else gets backed up and overwritten.
    function isMergeableItemSelector(obj) {
        return !!(obj && obj.model &&
            obj.model.type === 'minecraft:select' &&
            obj.model.property === 'minecraft:custom_model_data' &&
            Array.isArray(obj.model.cases));
    }

    // Merge a new model into an existing item definition: replace the case for
    // modelBaseName if present, else append it. Returns the merged object.
    function mergeItemSelector(existing, modelBaseName, exportedSlots) {
        const node = buildDisplayContextModel(modelBaseName, exportedSlots);
        const cases = existing.model.cases.filter(c => c.when !== modelBaseName);
        cases.push({ when: modelBaseName, model: node });
        existing.model.cases = cases;
        // Heal an old file that predates this field (default true breaks the
        // hand animation); see buildItemSelector.
        existing.hand_animation_on_swap = false;
        return existing;
    }

    // A base item can hold several models, and users may add their own commands.
    // Preserve the existing text verbatim and append only a missing command.
    function appendGiveCommand(fs, filePath, command) {
        let existing = '';
        try {
            existing = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            // Only a missing file starts empty. A read error must not erase it.
            if (error.code !== 'ENOENT') throw error;
        }
        const line = command.trim();
        if (existing.split(/\r\n|\n|\r/).some(saved => saved.trim() === line)) return;
        const newline = (existing.match(/\r\n|\n|\r/) || ['\n'])[0];
        const separator = existing && !/[\r\n]$/.test(existing) ? newline : '';
        const tmp = filePath + '.tmp';
        fs.writeFileSync(tmp, existing + separator + line + newline, 'utf8');
        fs.renameSync(tmp, filePath);
    }

    function saveSingleOutput(result, displayTransforms, cfg) {
        return new Promise((resolve, reject) => {
            const fs   = require('fs');
            const path = require('path');
            const name = (Project.name || 'model').replace(/[^a-z0-9_]/gi,'_').toLowerCase();
            const filesOnly = cfg.outputMode === 'files';
            if (filesOnly && (cfg.exportAsEquipment || cfg.generateDatapack || cfg.exportCameras))
                throw new Error(t('err_files_options'));
            const textureResource = filesOnly ? String(cfg.textureResource || '').trim() : '';
            if (textureResource && (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(textureResource)
                || textureResource.endsWith('.png') || textureResource.split(':')[1].split('/').some(p => !p || p === '.' || p === '..')))
                throw new Error(t('err_texture_resource'));
            const horse = equipmentOf(cfg);
            const legacyHorse = !!horseEquipmentOf(cfg) && !result.faceToEquipmentBinding;
            const animalLayers = horse && !legacyHorse ? planAnimalLayers(result,cfg) : null;
            // Validate the new equipment format before touching any output files.
            if (horse && result.tw < 16) throw new Error('Horse equipment needs a texture at least 16px wide.');
            if (horse && (!Number.isInteger(result.nfaces) || result.nfaces < 1 || result.nfaces > 65535))
                throw new Error('Horse equipment supports 1 to 65535 faces per model.');

            // One-shot: pick the resource pack root once (only if not already
            // set). Everything else is written without further dialogs.
            const root = (filesOnly ? (cfg.modelOutputDir || cfg.filesOutputDir) : cfg.resourcePackDir) || pickDirectory(t(filesOnly ? 'lbl_model_dir' : 'lbl_respack_dir'), Project.export_path || '');
            if (!root) { reject(new Error('__cancelled__')); return; }
            // Select both destinations before writing anything: cancelling the
            // second picker must not leave a partial export.
            const textureRoot = filesOnly ? (cfg.textureOutputDir || cfg.filesOutputDir || pickDirectory(t('lbl_texture_dir'), root)) : null;
            if (filesOnly && !textureRoot) { reject(new Error('__cancelled__')); return; }

            const baseItem = horse ? horse.item : (cfg.baseItem || 'iron_ingot').replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'iron_ingot';
            // custom_model_data name (issue #7). Used as BOTH the per-slot model
            // file base AND the custom_model_data case key, so the UI-facing name
            // and the in-game key the player puts on the item match. Falls back to
            // the sanitized project name when cfg.cmdName is unset.
            const modelName = ((cfg.cmdName || name).replace(/[^a-z0-9_]/gi, '_').toLowerCase()) || name;
            const horseAsset = horse ? `${modelName}_${horse.layer}` : null;
            const horseGive = horse ? `give @s minecraft:${horse.item}[minecraft:custom_model_data={strings:["${modelName}"]},minecraft:equippable=${animalEquippable(horse, horseAsset, legacyHorse)},minecraft:tooltip_display={hidden_components:["minecraft:dyed_color"]}]` : null;
            const texDir   = filesOnly ? textureRoot : path.join(root, 'assets', EXPORT_NS, 'textures', 'item');
            const modelsDir= filesOnly ? root : path.join(root, 'assets', EXPORT_NS, 'models', 'item');
            const itemsDir = path.join(root, 'assets', 'minecraft', 'items');
            fs.mkdirSync(texDir,    { recursive: true });
            fs.mkdirSync(modelsDir, { recursive: true });
            if (!filesOnly) fs.mkdirSync(itemsDir,  { recursive: true });

            // PNG → assets/objcubed/textures/item/<modelName>.png (no Blockbench.export).
            // Named after modelName so the per-slot model texture refs resolve.
            fs.writeFileSync(path.join(texDir, `${modelName}.png`), result.pngBuffer);

            // Determine which slots need their own model JSON. A slot differs
            // from the fallback (thirdperson_righthand) if it has a non-zero
            // SLOT_OFFSET or a non-identity displayTransforms entry. Both hand
            // contexts always need a model carrying their explicit v3 flag.
            const FALLBACK_SLOT = 'thirdperson_righthand';
            const isIdentity = d => {
                if (!d) return true;
                const r = d.rotation || [0,0,0], tr = d.translation || [0,0,0], s = d.scale || [1,1,1];
                return r[0]===0 && r[1]===0 && r[2]===0 &&
                       tr[0]===0 && tr[1]===0 && tr[2]===0 &&
                       s[0]===1 && s[1]===1 && s[2]===1;
            };
            const exportedSlots = DISPLAY_SLOTS.filter(slot => {
                if (Array.isArray(cfg.selectedContexts)) return cfg.selectedContexts.includes(slot);
                if (slot === FALLBACK_SLOT || slot === 'firstperson_righthand' || slot === 'firstperson_lefthand') return true;
                const off = SLOT_OFFSETS[slot] || { x:0, y:0, z:0 };
                if (off.x !== 0 || off.y !== 0 || off.z !== 0) return true;
                if (displayTransforms[slot] && !isIdentity(displayTransforms[slot])) return true;
                return false;
            });

            // Per-slot model JSONs → assets/objcubed/models/item/<modelName>_<slot>.json.
            //
            // VERTICAL-ORIGIN CONVENTION (in-game verified): the encoder bakes
            // Y-0.5 into the PNG positions, the carrier anchor c2 sits at the
            // block centre (from[8,8,8]), and the shader reconstructs display R*S
            // from the carrier edges — so with ALL lifts at 0 every slot matches
            // the same vanilla model exactly, rotations included. SLOT_LIFT_Y is
            // kept as a per-pose tuning knob (change only against in-game checks)
            // and so every slot gets an EXPLICIT display entry, which stops
            // Minecraft leaking block-model display defaults (scale ~0.4 / rot 45)
            // into un-set slots. The user's dialog display values add on top.
            // Written here — NOT in buildDisplayTransforms (it must stay a faithful
            // passthrough, see model-output.test) and NOT on cfg.displaySlots
            // (that would trip the hasStaticWorldDisplay bit).
            // gui has no model.json display at all: its transform is header-encoded
            // and applied by the GUI shader path.
            const SLOT_LIFT_Y = {
                head: 0, fixed: 0,
                thirdperson_righthand: 0, thirdperson_lefthand: 0,
                firstperson_righthand: 0, firstperson_lefthand: 0,
                // ground/on_shelf sit a FULL block below vanilla's dropped-item
                // pipeline (in-game measured). Carrier elements provide +0.5
                // (SLOT_OFFSETS +8 — capped by the model format, to.y <= 32);
                // the other +0.5 comes from the shader via the MARKED_UV_SLOTS
                // slot marker. Display translation is useless here: MC clamps
                // ground translation Y (re-verified in-game 2026-07).
                ground: 0, on_shelf: 0,
            };
            const liftSlot = (d, lift) => {
                const base = d || IDENTITY_DISPLAY;
                const t = base.translation || [0, 0, 0];
                return { ...base, translation: [t[0] || 0, (t[1] || 0) + lift, t[2] || 0] };
            };
            // (The -0.5 vertical-origin re-anchor is baked into the PNG for ALL
            // exports, armor included — the armor SHADER path re-adds it. No
            // element-shift compensation here: a shifted anchor rotates with the
            // display and only matched at identity.)
            // v3 slot markers: same deterministic assignment buildOutput used
            // for the PNG's dynamic table (both derive from displayTransforms).
            const slotMarkerIds = assignSlotMarkers(displayTransforms).ids;
            const writeSlotJson = (fileSlot, displayLookupSlot, markerId) => {
                const slotDisplay = { ...displayTransforms };
                for (const s in SLOT_LIFT_Y) slotDisplay[s] = liftSlot(slotDisplay[s], SLOT_LIFT_Y[s]);
                // The unset-slot fallback stops MC block-model display defaults
                // (scale ~0.4 / rot 45) leaking into the active slot.
                if (!slotDisplay[displayLookupSlot]) slotDisplay[displayLookupSlot] = IDENTITY_DISPLAY;
                fs.writeFileSync(
                    path.join(modelsDir, `${modelName}_${fileSlot}.json`),
                    buildSlotModelJson(modelName, fileSlot, slotDisplay,
                        calibratedElementsForSlot(result.elements, displayLookupSlot, markerId), textureResource),
                    'utf8'
                );
            };
            for (const slot of exportedSlots) {
                writeSlotJson(slot, slot, slotMarkerIds.get(slot) || 0);
            }
            // Neutral fallback for contexts without their own case (marker id 0,
            // no SLOT_OFFSETS calibration — those slots are all exported).
            writeSlotJson('default', 'thirdperson_righthand', 0);
            if (filesOnly) { resolve(); return; }

            // Item override → assets/minecraft/items/<baseItem>.json. Merge a new
            // custom_model_data case into an existing matching file so a second
            // model on the same base item coexists; back up + overwrite if the
            // existing file is not our expected shape.
            const itemPath = path.join(itemsDir, `${baseItem}.json`);
            let itemObj;
            if (fs.existsSync(itemPath)) {
                let existing = null;
                try { existing = JSON.parse(fs.readFileSync(itemPath, 'utf8')); } catch (e) { existing = null; }
                if (existing && isMergeableItemSelector(existing)) {
                    itemObj = mergeItemSelector(existing, modelName, exportedSlots);
                    // Keep vanilla fallback pointed at the requested base item.
                    itemObj.model.fallback = { type: 'minecraft:model', model: `minecraft:item/${baseItem}` };
                } else {
                    try { fs.writeFileSync(itemPath + '.bak', fs.readFileSync(itemPath)); } catch (e) {}
                    itemObj = buildItemSelector(modelName, exportedSlots, baseItem);
                }
            } else {
                itemObj = buildItemSelector(modelName, exportedSlots, baseItem);
            }
            // Atomic write: this file aggregates EVERY model's custom_model_data case on
            // this base item, so a half-written/interrupted overwrite would destroy them
            // all. Stage to .tmp then rename (atomic on the same filesystem).
            { const tmp = itemPath + '.tmp';
              fs.writeFileSync(tmp, JSON.stringify(itemObj, null, 2), 'utf8');
              fs.renameSync(tmp, itemPath); }

            // give helper → assets/minecraft/items/<baseItem>_give.txt. The exact
            // command the player runs to get the base item carrying this model's
            // custom_model_data string. 1.21.4+ component shape: the
            // minecraft:custom_model_data component holds {strings:[...]} and the
            // item override's custom_model_data select reads index 0 of strings
            // (see buildItemSelector index:0), so strings[0] must equal modelName.
            appendGiveCommand(fs,
                path.join(itemsDir, `${baseItem}_give.txt`),
                horseGive || `give @s minecraft:${baseItem}[minecraft:custom_model_data={strings:["${modelName}"]}]`
            );

            // 26.3's vanilla items atlas already discovers textures/item in
            // every namespace. Adding that directory to blocks duplicates all
            // item sprites. Leave existing user atlas files untouched.

            // Datapack: only for multi-frame animations. Default to a datapacks/
            // folder next to the resource pack (no extra dialog when root is set).
            if (cfg.generateDatapack && result.nframes > 1) {
                // Legacy single-part armor exports write the equipment asset as
                // <model>_<slot> (per-piece exports use <model>_<piece>) — tell the
                // datapack the real name so its summon equips an asset that exists.
                const legacyEquipAsset = (cfg.exportAsEquipment
                    && !(Array.isArray(cfg.selectedPieces) && cfg.selectedPieces.length))
                    ? `${modelName}_${(cfg.equipmentSlot || 'chest').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`
                    : null;
                const dpFiles = generateDatapackFiles(
                    cfg.datapackAnimId, result.nframes,
                    cfg.datapackNamespace, horse ? 'horse' : cfg.datapackTargetType,
                    horse ? horse.slot : cfg.datapackEquipSlot,
                    baseItem, modelName, horseAsset || legacyEquipAsset,
                    horse ? horse.layer : 'humanoid', legacyHorse, result.cameras
                );
                // Empty output dir defaults to a sibling of the resource pack. That default
                // is unwritable when the RP root is a Flatpak document-portal mount
                // (/run/user/.../doc/<id>/ — the portal grants the picked folder, not its
                // parent → mkdir EPERM). Don't let that abort the export (the RP already
                // wrote); warn with the path + the fix (pick a datapack folder explicitly).
                const dpBase = cfg.datapackOutputDir || path.join(root, '..', 'datapacks');
                const dpDir = path.join(dpBase, 'objcubed');
                try {
                    saveDatapackFiles(dpFiles, dpDir);
                } catch (e) {
                    surfaceWarning(`couldn't write the datapack to "${dpDir}" (${(e && e.message) || e}). The model + resource pack exported fine; to get the datapack, set the "Datapack output folder" to a writable location (e.g. your world's datapacks/ folder) and re-export.`);
                }
            } else if (cfg.generateDatapack && result.nframes <= 1) {
                // Datapack drives multi-frame playback; a single frame has nothing to
                // play. Silently skipping left the user expecting control functions.
                surfaceWarning('No datapack was created: the model has only one frame. Export an animation with at least two frames.');
            }

            // Equipment (armor) export — Approach C. Written under the SAME
            // resource pack root as the item layout above, but into the vanilla
            // minecraft namespace (equipment defs + textures must live there).
            if (horse) {
                const equipJsonDir = path.join(root, 'assets', 'minecraft', 'equipment');
                const eqTexDir = path.join(root, 'assets', 'minecraft', 'textures', 'entity', 'equipment', horse.layer);
                fs.mkdirSync(equipJsonDir, { recursive: true });
                fs.mkdirSync(eqTexDir, { recursive: true });
                const faceEmission = result.faceEmission || (result.faceGroups || []).map(g => {
                    const token = parseFaceToken(g); return token ? token.emis : 0;
                });
                const layers = [];
                // One unique body-cube face carries one OBJ face. All other native
                // horse geometry is rejected by marker-252 decoding, before lookup.
                for (let layer = 0; layer < (animalLayers ? animalLayers.length : Math.ceil(result.nfaces / 6)); layer++) {
                    const buf = new Uint8Array(result.rawBuf);
                    buf[3] = 252;
                    for (let face = 0; face < 6; face++) {
                        const k = layer * 6 + face;
                        const index = k < result.nfaces ? k : 65535;
                        const at = (8 + face) * 4;
                        buf[at] = index >> 8; buf[at + 1] = index & 255;
                        buf[at + 2] = k < result.nfaces ? Math.max(0, Math.min(15, faceEmission[k] | 0)) : 0;
                        buf[at + 3] = face === 0 ? 1 : face === 1 ? HORSE_EQUIPMENT[cfg.equipmentTarget]?.kind || 0 : 0;
                    }
                    const texName = `${horseAsset}_${layer}`;
                    fs.writeFileSync(path.join(eqTexDir, `${texName}.png`), animalLayers ? encodeAnimalLayer(result,cfg,animalLayers[layer],faceEmission) : encodePNG(result.tw, result.ty, buf));
                    layers.push({ texture: `minecraft:${texName}`, dyeable: { color_when_undyed: 16777215 } });
                }
                fs.writeFileSync(path.join(equipJsonDir, `${horseAsset}.json`),
                    JSON.stringify({ layers: { [horse.layer]: layers } }, null, 2), 'utf8');
                appendGiveCommand(fs, path.join(equipJsonDir, `${horseAsset}_give.txt`), horseGive);
            }
            if (cfg.exportAsEquipment && !horse) {
                const equipNs = 'minecraft';
                const equipJsonDir = path.join(root, 'assets', equipNs, 'equipment');
                fs.mkdirSync(equipJsonDir, { recursive: true });
                const nLayers = result.nfaces;
                // Each armor PIECE -> layer type, slot, give item, the body parts it covers,
                // and its CARRIER box layout (abody -> part, from the shader's ABOX table) for
                // box-packing: one layer rides TWO model faces per carrier box (its NORTH and
                // SOUTH face), so a chestplate packs body+r_arm+l_arm x2 faces into one draw.
                // Parts: 0 body,1 head,2 r_arm,3 l_arm,4 r_leg,5 l_leg,6 r_foot,7 l_foot,
                // 8 waist (an export-side alias: rides the leggings layer's body box, so
                // it's written as part 0 — the shader then applies the body AOFF/carrier).
                // `tags` maps each carrier box to the FACE TAG it collects (defaults to
                // `carrier`); only leggings needs it, to pull waist(8) into its body box.
                const PIECE_MAP = {
                    helmet:     { layer: 'humanoid',          slot: 'head',  give: 'helmet',     allowed: [1],       carrier: [1],       nboxes: 2 },
                    chestplate: { layer: 'humanoid',          slot: 'chest', give: 'chestplate', allowed: [0, 2, 3], carrier: [2, 3, 0], nboxes: 3 },
                    leggings:   { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   allowed: [4, 5, 8], carrier: [5, 4, 0], tags: [5, 4, 8], nboxes: 3 },
                    boots:      { layer: 'humanoid',          slot: 'feet',  give: 'boots',      allowed: [6, 7],    carrier: [7, 6],    nboxes: 2 },
                };
                // Per-face emissive levels (light_emission, 0..15) so the armor shader can make
                // individual faces fullbright -- the vanilla light_emission model property only
                // affects item/block models, never equipment layers.
                const faceEmission = result.faceEmission
                    || (result.faceGroups || []).map(g => { const tk = parseFaceToken(g); return tk ? tk.emis : 0; });
                // Write one packed layer PNG: t[8].a = nboxes; per box abody, 4 carrier-face
                // model-face indices (16-bit) -> north t[8+abody].r:g (part in .b), south
                // t[11+abody], west header-texel 14+abody, east 17+abody; the 4 faces' emissive
                // levels pack into texel 20+abody (r=N,g=S,b=W,a=E). Missing face -> 65535
                // (culled). Header texels reach 20+nboxes-1 (=22 for 3 boxes) -> needs tw >= 23.
                const writePackedLayer = (texPath, nboxes, slots, parts) => {
                    const buf = result.rawBuf.slice();
                    buf[3] = 253;                               // armor marker
                    buf[8 * 4 + 3] = nboxes & 255;              // t[8].a = box count
                    const put16 = (texel, k) => {
                        const o = texel * 4;
                        if (k == null) { buf[o] = 255; buf[o + 1] = 255; }
                        else { buf[o] = Math.trunc(k / 256) % 256; buf[o + 1] = k % 256; }
                    };
                    const emisOf = k => (k == null ? 0 : Math.max(0, Math.min(15, faceEmission[k] | 0)));
                    for (let abody = 0; abody < nboxes; abody++) {
                        const s = slots[abody] || {};
                        put16(8 + abody, s.northK);             // north -> t[8+abody].r:g
                        // Write the part id even for boxes with no faces in this layer:
                        // the 26.2 uv decode selects boxes BY part, and a zeroed id
                        // reads as "body" and shadows the real body box.
                        buf[(8 + abody) * 4 + 2] = (s.part != null ? s.part : (parts ? parts[abody] : 0) || 0) & 255;
                        put16(11 + abody, s.southK);            // south -> t[11+abody]
                        put16(14 + abody, s.westK);             // west  -> texel 14+abody
                        put16(17 + abody, s.eastK);             // east  -> texel 17+abody
                        const eo = (20 + abody) * 4;            // emissive -> texel 20+abody
                        buf[eo] = emisOf(s.northK); buf[eo + 1] = emisOf(s.southK);
                        buf[eo + 2] = emisOf(s.westK); buf[eo + 3] = emisOf(s.eastK);
                    }
                    fs.writeFileSync(texPath, encodePNG(result.tw, result.ty, buf));
                };
                // The packed armor header reaches row-0 column 22, so a <23px-wide
                // texture corrupts equipment (W/E faces + emissive). Surface it.
                if (result.tw < 23) throw new Error(`armor texture is only ${result.tw}px wide — equipment packing needs ≥23px (west/east faces + emissive pack to row-0 texel 22). Widen the texture and re-export.`);

                if (Array.isArray(cfg.selectedPieces) && cfg.selectedPieces.length) {
                    // PER-PIECE (whole-set) export, BOX-PACKED.
                    const faceToPart = result.faceToPart || buildFaceToPart(result.faceGroups, result.faceBlocks);
                    const _partCounts = {};
                    faceToPart.forEach(p => { _partCounts[p] = (_partCounts[p] || 0) + 1; });
                    console.log('[obj³] armor face→part counts (-1 = untagged):', JSON.stringify(_partCounts));
                    // Untagged faces (part -1) are silently dropped from every piece — tell the user.
                    if (_partCounts[-1] > 0) surfaceWarning(`${_partCounts[-1]} face(s) have no body-part assignment and will be absent from the armor. Assign their groups through right-click → obj³: Body part.`);
                    for (const pieceKey of cfg.selectedPieces) {
                        const piece = PIECE_MAP[pieceKey];
                        if (!piece) continue;
                        const eqName = `${modelName}_${pieceKey}`;
                        const eqTexDir = path.join(root, 'assets', equipNs, 'textures', 'entity', 'equipment', piece.layer);
                        fs.mkdirSync(eqTexDir, { recursive: true });
                        // Faces per carrier box (by abody) = that box's TAG's faces, in order.
                        const boxFaces = (piece.tags || piece.carrier).map(tag =>
                            piece.allowed.indexOf(tag) === -1 ? []
                                : faceToPart.reduce((a, p, k) => { if (p === tag) a.push(k); return a; }, []));
                        // Four faces per box per layer: north@4L, south@4L+1, west@4L+2, east@4L+3.
                        const layerCount = Math.max(1, ...boxFaces.map(f => Math.ceil(f.length / 4)));
                        const layers = [];
                        for (let L = 0; L < layerCount; L++) {
                            const slots = piece.carrier.map((part, abody) => {
                                const fk = j => { const k = boxFaces[abody][4 * L + j]; return k == null ? null : k; };
                                const nk = fk(0), sk = fk(1), wk = fk(2), ek = fk(3);
                                if (nk == null && sk == null && wk == null && ek == null) return undefined;
                                return { northK: nk, southK: sk, westK: wk, eastK: ek, part };
                            });
                            if (slots.every(s => !s)) continue;           // empty layer
                            const texName = `${eqName}_${L}`;
                            writePackedLayer(path.join(eqTexDir, `${texName}.png`), piece.nboxes, slots, piece.carrier);
                            layers.push({ texture: `${equipNs}:${texName}`,
                                // dyeable: the datapack drives playback through minecraft:dyed_color
                                // (the shader reads the layer tint); undyed stays white = autoplay header.
                                dyeable: { color_when_undyed: 16777215 } });
                        }
                        // A piece with no tagged faces would write an empty {layers:{type:[]}}
                        // def (invisible armor) and still report success — skip + tell the user.
                        if (layers.length === 0) {
                            surfaceWarning(`Armor piece "${pieceKey}" was not exported: no faces belong to it. Assign the relevant groups through right-click → obj³: Body part.`);
                            continue;
                        }
                        fs.writeFileSync(path.join(equipJsonDir, `${eqName}.json`),
                            JSON.stringify({ layers: { [piece.layer]: layers } }, null, 2), 'utf8');
                        appendGiveCommand(fs, path.join(equipJsonDir, `${eqName}_give.txt`),
                            // equip_sound intentionally_empty: the datapack drives playback by
                            // item-replacing the worn piece (dye control word) — the default
                            // equip sound would replay on EVERY play/stop/set call.
                            // tooltip_display hides the dye line ("Dyed") — the dye is the
                            // datapack's playback control word, not something to show.
                            `give @s minecraft:leather_${piece.give}[minecraft:equippable={slot:"${piece.slot}",asset_id:"${equipNs}:${eqName}",equip_sound:"minecraft:intentionally_empty"},minecraft:tooltip_display={hidden_components:["minecraft:dyed_color"]}]`);
                    }
                } else {
                    // LEGACY single-part export: whole model anchored to ONE part. Uses the
                    // same box-packed format with only the target box active (others empty),
                    // two faces per layer (north + south) like the per-piece path.
                    const PART_MAP = {
                        chest:      { layer: 'humanoid',          slot: 'chest', give: 'chestplate', carrier: [2, 3, 0], nboxes: 3, id: 0 },
                        head:       { layer: 'humanoid',          slot: 'head',  give: 'helmet',     carrier: [1],       nboxes: 2, id: 1 },
                        right_arm:  { layer: 'humanoid',          slot: 'chest', give: 'chestplate', carrier: [2, 3, 0], nboxes: 3, id: 2 },
                        left_arm:   { layer: 'humanoid',          slot: 'chest', give: 'chestplate', carrier: [2, 3, 0], nboxes: 3, id: 3 },
                        right_leg:  { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   carrier: [5, 4, 0], nboxes: 3, id: 4 },
                        left_leg:   { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   carrier: [5, 4, 0], nboxes: 3, id: 5 },
                        right_foot: { layer: 'humanoid',          slot: 'feet',  give: 'boots',      carrier: [7, 6],    nboxes: 2, id: 6 },
                        left_foot:  { layer: 'humanoid',          slot: 'feet',  give: 'boots',      carrier: [7, 6],    nboxes: 2, id: 7 },
                        legs:       { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   carrier: [5, 4, 0], nboxes: 3, id: 5 },
                        waist:      { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   carrier: [5, 4, 0], nboxes: 3, id: 0 },
                        feet:       { layer: 'humanoid',          slot: 'feet',  give: 'boots',      carrier: [7, 6],    nboxes: 2, id: 7 },
                    };
                    const partInfo = PART_MAP[cfg.equipmentSlot] || PART_MAP.chest;
                    const abodyOfTarget = Math.max(0, partInfo.carrier.indexOf(partInfo.id));
                    const layerType = partInfo.layer;
                    const slotKey = (cfg.equipmentSlot || 'chest').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
                    const eqName = `${modelName}_${slotKey}`;
                    const eqTexDir = path.join(root, 'assets', equipNs, 'textures', 'entity', 'equipment', layerType);
                    fs.mkdirSync(eqTexDir, { recursive: true });
                    const layers = [];
                    const fk = i => (i < nLayers) ? i : null;
                    for (let L = 0; L < Math.ceil(nLayers / 4); L++) {
                        const slots = [];
                        slots[abodyOfTarget] = {
                            northK: 4 * L,
                            southK: fk(4 * L + 1),
                            westK: fk(4 * L + 2),
                            eastK: fk(4 * L + 3),
                            part: partInfo.id,
                        };
                        const texName = `${eqName}_${L}`;
                        writePackedLayer(path.join(eqTexDir, `${texName}.png`), partInfo.nboxes, slots, partInfo.carrier);
                        layers.push({ texture: `${equipNs}:${texName}`,
                                // dyeable: the datapack drives playback through minecraft:dyed_color
                                // (the shader reads the layer tint); undyed stays white = autoplay header.
                                dyeable: { color_when_undyed: 16777215 } });
                    }
                    fs.writeFileSync(path.join(equipJsonDir, `${eqName}.json`),
                        JSON.stringify({ layers: { [layerType]: layers } }, null, 2), 'utf8');
                    appendGiveCommand(fs, path.join(equipJsonDir, `${eqName}_give.txt`),
                        `give @s minecraft:leather_${partInfo.give}[minecraft:equippable={slot:"${partInfo.slot}",asset_id:"${equipNs}:${eqName}",equip_sound:"minecraft:intentionally_empty"},minecraft:tooltip_display={hidden_components:["minecraft:dyed_color"]}]`);
                }
            }

            resolve();
        });
    }

    // =========================================================
    // Section 10b: Datapack Function Generation
    // =========================================================

    function generateDatapackFiles(animId, nframes, namespace, targetType, equipSlot, baseItem, modelName, equipAsset, equipmentTarget, legacyHorse = true, cameras = []) {
        const horse = equipmentOf({ exportAsEquipment: true, equipmentTarget });
        legacyHorse = legacyHorse && !!HORSE_EQUIPMENT[equipmentTarget];
        if (horse) { targetType = horse.entity; equipSlot = horse.slot; baseItem = horse.item; }
        // equipAsset (optional): the exact equipment asset id suffix the resource
        // pack export actually wrote (legacy single-part exports name it by SLOT,
        // e.g. "cat_chest", while per-piece exports name it by PIECE, "cat_chestplate").
        // Without it the summon defaults to the per-piece convention.
        // Sanitize to valid resource-location chars [a-z0-9_.-]: free-text like
        // "My Pack" / "Walk!" would otherwise produce invalid namespaces and
        // `function ns:id` refs (baseItem/cmdName are already sanitized this way).
        const ns = ((namespace || 'objcubed').toLowerCase().replace(/[^a-z0-9_.-]/g, '_')) || 'objcubed';
        const id = ((animId || 'anim').toLowerCase().replace(/[^a-z0-9_.-]/g, '_')) || 'anim';
        if (ns === 'objcubed' && id === '__camera') throw new Error('Animation ID "__camera" is reserved for camera controls.');
        // Scoreboard objectives get their own namespace prefix so generated
        // objectives can't collide with a map's own scoreboards named after models.
        const sb = `objcubed.${id}`;
        const pub = `${id}`;
        const priv = `${id}/zzz`;
        const files = new Map();

        const EQUIP_PATH = {
            mainhand: 'equipment.mainhand', offhand: 'equipment.offhand',
            head: 'equipment.head', chest: 'equipment.chest',
            legs: 'equipment.legs', feet: 'equipment.feet',
            body: 'equipment.body', saddle: 'equipment.saddle',
        };
        const PLAYER_SLOT = {
            mainhand: 'weapon.mainhand', offhand: 'weapon.offhand',
            head: 'armor.head', chest: 'armor.chest',
            legs: 'armor.legs', feet: 'armor.feet',
        };

        const isPlayer = targetType === 'player';
        const equipPath = targetType === 'item_display'
            ? 'item'
            : (EQUIP_PATH[equipSlot] || 'equipment.mainhand');
        const playerSlot = PLAYER_SLOT[equipSlot] || 'weapon.mainhand';
        // Armor renders as equipment layers: the tint channel there is the DYE
        // color (layers are exported dyeable), not the potion color.
        const isArmor = ['head', 'chest', 'legs', 'feet', 'body', 'saddle'].includes(equipSlot);
        const compSet = isArmor
            ? `${equipPath}.components."minecraft:dyed_color" set value 0`
            : `${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`;
        const compStore = isArmor
            ? `${equipPath}.components."minecraft:dyed_color" int 1`
            : `${equipPath}.components."minecraft:potion_contents".custom_color int 1`;
        // Per-run isolation (A5): a per-animation tag + tight distance relative to
        // the executing player (@s) so concurrent player runs each grab only the
        // stand at their own feet (not another player's leftover stand).
        const tmpTag = `objcubed_temp_${id}`;
        const tmp = `@e[tag=${tmpTag},distance=..0.01,limit=1,sort=nearest]`;
        // Marker:1b -> no collision; Silent:1b -> the stand's own equip sound is
        // muted when the item is copied onto it; spawn AT the player (execute at
        // @s) so the distance filter resolves to a stand at the player's position.
        const tmpSummon = `execute at @s run summon armor_stand ~ ~ ~ {Tags:["${tmpTag}"],Invisible:1b,Marker:1b,Silent:1b}`;

        files.set('pack.mcmeta', JSON.stringify({
            pack: {
                description: 'obj³ animations',
                // Minecraft 26.3 data-pack format. Do not claim compatibility
                // with future formats whose commands/components can change.
                min_format: [121, 0],
                max_format: [121, 0],
            },
        }, null, 2));

        // init — scoreboards + constants
        files.set(`data/${ns}/function/${pub}/init.mcfunction`, [
            `scoreboard objectives add ${sb} dummy`,
            `scoreboard objectives add ${sb}.end dummy`,
            `scoreboard players set #dur ${sb} ${nframes}`,
            `scoreboard players set #base ${sb} 8388608`,
            `scoreboard players set #cycle ${sb} 24000`,
        ].join('\n'));

        // play — autoplay loop starting at frame 0 (synced to GameTime). Stores the
        // phase offset (gametime % dur) so frame 0 shows now and advances; re-issuing
        // restarts cleanly. (The old code did `-= @s` first, which on a second call read
        // the stored OFFSET as if it were the frame and jumped to a stale phase — use
        // play_from to start at a specific frame.) NOTE: every call re-stamps the
        // phase ("frame 0 = now") — calling play from a tick loop pins frame 0.
        files.set(`data/${ns}/function/${pub}/play.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `execute store result score #gt ${sb} run time query gametime`,
            `scoreboard players operation #gt ${sb} %= #dur ${sb}`,
            `scoreboard players operation @s ${sb} = #gt ${sb}`,
            `tag @s add ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_auto`,
        ].join('\n'));

        // stop — freeze at current frame
        files.set(`data/${ns}/function/${pub}/stop.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `# play_once: freeze at last frame`,
            `execute if entity @s[tag=${id}.once] run function ${ns}:${priv}/_stop_once`,
            `# autoplay: compute current frame`,
            `execute if entity @s[tag=${id}.auto] run function ${ns}:${priv}/_stop_auto`,
            `tag @s remove ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_manual`,
        ].join('\n'));

        // _stop_once — freezes at the last frame
        files.set(`data/${ns}/function/${priv}/_stop_once.mcfunction`, [
            `scoreboard players operation @s ${sb} = #dur ${sb}`,
            `scoreboard players remove @s ${sb} 1`,
        ].join('\n'));

        // _stop_auto — computes current frame
        files.set(`data/${ns}/function/${priv}/_stop_auto.mcfunction`, [
            `execute store result score #gt ${sb} run time query gametime`,
            `scoreboard players operation #gt ${sb} -= @s ${sb}`,
            `scoreboard players operation #gt ${sb} %= #dur ${sb}`,
            `scoreboard players operation @s ${sb} = #gt ${sb}`,
        ].join('\n'));

        // set — freeze at specific frame (user sets @s objcubed.<id> = frame before calling)
        files.set(`data/${ns}/function/${pub}/set.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `tag @s remove ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_manual`,
        ].join('\n'));

        // play_from — autoplay loop from frame N (user sets @s objcubed.<id> = N before calling)
        files.set(`data/${ns}/function/${pub}/play_from.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `execute store result score #gt ${sb} run time query gametime`,
            `scoreboard players operation #gt ${sb} -= @s ${sb}`,
            `scoreboard players operation #gt ${sb} %= #dur ${sb}`,
            `scoreboard players operation @s ${sb} = #gt ${sb}`,
            `tag @s add ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_auto`,
        ].join('\n'));

        // play_once — play one cycle then freeze at last frame.
        // Records an absolute deadline (monotonic gametime, NOT day-wrapped) so the
        // tick latch can freeze the entity permanently after nframes ticks.
        files.set(`data/${ns}/function/${pub}/play_once.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `execute store result score @s ${sb} run time query gametime`,
            `scoreboard players operation @s ${sb} %= #cycle ${sb}`,
            `scoreboard players add @s ${sb} 32768`,
            // absolute deadline = now + nframes ticks (monotonic gametime, NOT day-wrapped)
            `execute store result score @s ${sb}.end run time query gametime`,
            `scoreboard players add @s ${sb}.end ${nframes}`,
            `tag @s remove ${id}.auto`,
            `tag @s add ${id}.once`,
            `function ${ns}:${priv}/_apply_auto`,
        ].join('\n'));

        // _apply_auto — set autoplay color (custom_color = tcolor from @s <id>)
        if (isPlayer) {
            // Every ${tmp} selector needs `at @s`: distance=..0.01 is measured from
            // the EXECUTION position, and the stand was summoned at @s — without it
            // a `execute as <player>` from a command block matches nothing (item
            // never updates + the temp stand leaks).
            files.set(`data/${ns}/function/${priv}/_apply_auto.mcfunction`, [
                tmpSummon,
                `execute at @s run item replace entity ${tmp} ${playerSlot} from entity @s ${playerSlot}`,
                `execute at @s run data modify entity ${tmp} ${compSet}`,
                `execute at @s store result entity ${tmp} ${compStore} run scoreboard players get @s ${sb}`,
                `execute at @s run item replace entity @s ${playerSlot} from entity ${tmp} ${playerSlot}`,
                `execute at @s run kill ${tmp}`,
            ].join('\n'));
        } else {
            files.set(`data/${ns}/function/${priv}/_apply_auto.mcfunction`, [
                `data modify entity @s ${compSet}`,
                `execute store result entity @s ${compStore} run scoreboard players get @s ${sb}`,
            ].join('\n'));
        }

        // _apply_manual — set manual color (custom_color = 0x800000 + frame from @s <id>)
        if (isPlayer) {
            files.set(`data/${ns}/function/${priv}/_apply_manual.mcfunction`, [
                `scoreboard players operation #temp ${sb} = #base ${sb}`,
                `scoreboard players operation #temp ${sb} += @s ${sb}`,
                tmpSummon,
                `execute at @s run item replace entity ${tmp} ${playerSlot} from entity @s ${playerSlot}`,
                `execute at @s run data modify entity ${tmp} ${compSet}`,
                `execute at @s store result entity ${tmp} ${compStore} run scoreboard players get #temp ${sb}`,
                `execute at @s run item replace entity @s ${playerSlot} from entity ${tmp} ${playerSlot}`,
                `execute at @s run kill ${tmp}`,
            ].join('\n'));
        } else {
            files.set(`data/${ns}/function/${priv}/_apply_manual.mcfunction`, [
                `scoreboard players operation #temp ${sb} = #base ${sb}`,
                `scoreboard players operation #temp ${sb} += @s ${sb}`,
                `data modify entity @s ${compSet}`,
                `execute store result entity @s ${compStore} run scoreboard players get #temp ${sb}`,
            ].join('\n'));
        }

        // tick latch: per-entity, freezes play_once at the last frame once its
        // absolute deadline passes (survives the GameTime day-wrap). Latch-only —
        // playback stays shader-driven (render-fps), this just flips once.
        files.set(`data/${ns}/function/${pub}/tick.mcfunction`, [
            `execute as @e[tag=${id}.once] run function ${ns}:${priv}/_check_once`,
        ].join('\n'));
        files.set(`data/${ns}/function/${priv}/_check_once.mcfunction`, [
            `execute store result score #now ${sb} run time query gametime`,
            `execute if score #now ${sb} >= @s ${sb}.end run function ${ns}:${priv}/_latch_once`,
        ].join('\n'));
        files.set(`data/${ns}/function/${priv}/_latch_once.mcfunction`, [
            `scoreboard players set @s ${sb} ${nframes - 1}`,   // static last frame
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_manual`,
        ].join('\n'));
        files.set('data/minecraft/tags/function/tick.json', JSON.stringify({
            values: [`${ns}:${pub}/tick`],
        }, null, 2));

        const base = (baseItem || 'stick').toLowerCase().replace(/[^a-z0-9_.]/g, '_') || 'stick';
        const model = (modelName || id);
        const entityTag = `${ns}.${pub}`;

        // load tag → init scoreboards once at datapack load (no manual init call)
        files.set('data/minecraft/tags/function/load.json', JSON.stringify({
            values: [`${ns}:${pub}/init`],
        }, null, 2));

        // summon.mcfunction — create + tag the entity this datapack animates.
        if (targetType === 'item_display') {
            files.set(`data/${ns}/function/${pub}/summon.mcfunction`, [
                `summon item_display ~ ~ ~ {Tags:["${entityTag}"],billboard:"fixed",item:{id:"minecraft:${base}",count:1,components:{"minecraft:custom_model_data":{strings:["${model}"]}}}}`,
            ].join('\n'));
        } else if (horse && !isPlayer) {
            const asset = equipAsset || `${model}_${horse.layer}`;
            files.set(`data/${ns}/function/${pub}/summon.mcfunction`,
                `summon ${horse.entity} ~ ~ ~ {Tags:["${entityTag}"],Tame:1b,equipment:{${horse.slot}:{id:"minecraft:${horse.item}",count:1,components:{"minecraft:equippable":${animalEquippable(horse, asset, legacyHorse)},"minecraft:custom_model_data":{strings:["${model}"]},"minecraft:tooltip_display":{hidden_components:["minecraft:dyed_color"]}}}}}`);
        } else if (!isPlayer) {
            // equipment target: an armor_stand summoned ALREADY wearing/holding the
            // obj³ item, so the per-slot equipment NBT exists for _apply_auto to
            // data-modify (an empty slot cannot be animated). The slot key is the
            // exact equipment NBT key (head/chest/legs/feet/mainhand/offhand).
            const ARMOR_PIECE = { head: 'helmet', chest: 'chestplate', legs: 'leggings', feet: 'boots' };
            const slot = ARMOR_PIECE[equipSlot] ? equipSlot : (EQUIP_PATH[equipSlot] ? equipSlot : 'mainhand');
            let equipItem;
            if (ARMOR_PIECE[slot]) {
                // ARMOR slot: leather piece carrying the equippable component that
                // points at the armor export asset (eqName = <model>_<piece>).
                const piece = ARMOR_PIECE[slot];
                equipItem = `${slot}:{id:"minecraft:leather_${piece}",count:1,components:{"minecraft:equippable":{slot:"${slot}",asset_id:"minecraft:${equipAsset || `${model}_${piece}`}",equip_sound:"minecraft:intentionally_empty"},"minecraft:tooltip_display":{hidden_components:["minecraft:dyed_color"]}}}`;
            } else {
                // HAND slot: the base item with custom_model_data (mirror item_display).
                equipItem = `${slot}:{id:"minecraft:${base}",count:1,components:{"minecraft:custom_model_data":{strings:["${model}"]}}}`;
            }
            files.set(`data/${ns}/function/${pub}/summon.mcfunction`, [
                `summon armor_stand ~ ~ ~ {Tags:["${entityTag}"],ShowArms:1b,NoGravity:1b,equipment:{${equipItem}}}`,
            ].join('\n'));
        }
        // player target: cannot be summoned — README documents the held-item path.

        files.set('README.txt', [
            `obj³ datapack — animation "${id}" (namespace "${ns}")`,
            ``,
            `INSTALL: drop this "objcubed" folder into <world>/datapacks/ and run /reload.`,
            `  (init scoreboards run automatically via the minecraft:load tag.)`,
            ``,
            targetType === 'item_display'
                ? `SPAWN:   function ${ns}:${pub}/summon   (creates a tagged item_display)`
                : (isPlayer
                    ? `SPAWN:   none — give yourself the item from ${base}_give.txt and run the controls as yourself.`
                    : horse
                        ? `SPAWN:   function ${ns}:${pub}/summon   (spawns ${horse.entity} wearing ${model}_${horse.layer}). Use its ${horse.slot} slot.`
                        : `SPAWN:   function ${ns}:${pub}/summon   (spawns an armor_stand ALREADY equipped with the obj³ item). To wear it yourself instead, give from ${model}_<piece>_give.txt.`),
            ``,
            `CONTROL (run AS the entity, e.g. execute as @e[tag=${ns}.${pub}] run …):`,
            `  ${ns}:${pub}/play        loop from frame 0 (call ONCE — a tick-looped play restarts every tick and pins frame 0)`,
            `  ${ns}:${pub}/play_once   play once then freeze`,
            `  ${ns}:${pub}/play_from   loop from frame N (set score @s ${sb} = N first)`,
            `  ${ns}:${pub}/set         freeze at frame N (set score @s ${sb} = N first)`,
            `  ${ns}:${pub}/stop        freeze at the current frame`,
            ``,
        ].join('\n'));

        if (cameras?.length) addCameraDatapack(files, {ns, id, sb, targetType, nframes, cameras});
        return files;
    }

    function addCameraDatapack(files, {ns, id, sb, targetType, nframes, cameras}) {
        if (targetType !== 'item_display') throw new Error(t('err_camera_target'));
        const names = new Set();
        for (const camera of cameras) {
            if (!/^[a-z0-9_-]{1,48}$/.test(camera.name) || names.has(camera.name)) throw new Error(t('err_camera_names'));
            names.add(camera.name);
            if (camera.frames.length !== nframes || camera.frames.some(p =>
                !['x','y','z','yaw','pitch'].every(k => Number.isFinite(p[k])) ||
                Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z)) > 30000000 || Math.abs(p.pitch) > 90))
                throw new Error(`Invalid camera track: ${camera.name}`);
        }
        const base = `${id}/camera`, store = `${ns}:${id}_cameras`, rootTag = `${ns}.${id}.camera_root`, camTag = `${ns}.${id}.camera`;
        const rootSelector = `@e[type=minecraft:item_display,tag=${rootTag}]`;
        const camSelector = `@e[type=minecraft:item_display,tag=${camTag}]`;
        const dims = ['minecraft:overworld','minecraft:the_nether','minecraft:the_end'];
        const put = (name, lines) => files.set(`data/${ns}/function/${base}/${name}.mcfunction`, lines.filter(Boolean).join('\n'));
        const append = (name, lines) => {
            const path = `data/${ns}/function/${id}/${name}.mcfunction`;
            files.set(path, files.get(path) + '\n' + lines.join('\n'));
        };
        const global = (name, lines) => files.set(`data/objcubed/function/__camera/${name}.mcfunction`, lines.join('\n'));
        // Shared viewer state is identical across exports. Re-export never resets
        // IDs or saved players; no hard-coded player names or nearest-player joins.
        global('init', ['oc.cam.id','oc.cam.owner','oc.cam.view','oc.cam.mode','oc.cam.pid','oc.cam.frame'].map(o => `scoreboard objectives add ${o} dummy`).concat([
            'scoreboard players add #next oc.cam.id 0',
        ]));
        global('save', [
            'execute unless score @s oc.cam.pid matches 1.. run scoreboard players add #next oc.cam.id 1',
            'execute unless score @s oc.cam.pid matches 1.. run scoreboard players operation @s oc.cam.pid = #next oc.cam.id',
            ...['survival','creative','adventure','spectator'].map((mode,i) => `execute if entity @s[gamemode=${mode}] run scoreboard players set @s oc.cam.mode ${i}`),
            'execute store result storage objcubed:camera args.id int 1 run scoreboard players get @s oc.cam.pid',
            'function objcubed:__camera/save_data with storage objcubed:camera args',
            'tag @s add oc.cam.viewer',
        ]);
        global('save_data', [
            '$data modify storage objcubed:camera returns.p$(id) set value {}',
            ...[['x','Pos[0]'],['y','Pos[1]'],['z','Pos[2]'],['yaw','Rotation[0]'],['pitch','Rotation[1]'],['dimension','Dimension']].map(([k,v]) =>
                `$data modify storage objcubed:camera returns.p$(id).${k} set from entity @s ${v}`),
        ]);
        global('exit', [
            'execute unless entity @s[type=minecraft:player,tag=oc.cam.viewer] run return 0',
            'execute store result storage objcubed:camera args.id int 1 run scoreboard players get @s oc.cam.pid',
            'function objcubed:__camera/exit_data with storage objcubed:camera args',
        ]);
        global('exit_data', [
            '$execute unless data storage objcubed:camera returns.p$(id) run return 0',
            'spectate',
            '$execute store success score #returned oc.cam.id run function objcubed:__camera/return_player with storage objcubed:camera returns.p$(id)',
            'execute unless score #returned oc.cam.id matches 1 run return 0',
            ...['survival','creative','adventure','spectator'].map((mode,i) => `execute if score @s oc.cam.mode matches ${i} run gamemode ${mode} @s`),
            '$data remove storage objcubed:camera returns.p$(id)',
            'tag @s remove oc.cam.viewer',
            'scoreboard players reset @s oc.cam.view',
        ]);
        global('return_player', ['$return run execute in $(dimension) run tp @s $(x) $(y) $(z) $(yaw) $(pitch)']);
        global('check_viewer', [
            'scoreboard players set #present oc.cam.id 0',
            'scoreboard players operation #view oc.cam.id = @s oc.cam.view',
            'execute as @e[type=minecraft:item_display,tag=oc.cam.entity] if score @s oc.cam.id = #view oc.cam.id run scoreboard players set #present oc.cam.id 1',
            'execute if score #present oc.cam.id matches 0 run function objcubed:__camera/exit',
        ]);
        global('tick', ['execute as @a[tag=oc.cam.viewer] at @s run function objcubed:__camera/check_viewer']);
        global('end_view', [
            'scoreboard players operation #view oc.cam.id = @s oc.cam.id',
            'execute as @a[tag=oc.cam.viewer] if score @s oc.cam.view = #view oc.cam.id run function objcubed:__camera/exit',
        ]);
        const load = ['function objcubed:__camera/init'];
        for (const camera of cameras) {
            load.push(`data modify storage ${store} tracks.${camera.name} set value []`);
            // Bound each command's size while keeping one table lookup per camera.
            for (let f=0;f<camera.frames.length;f+=128) {
                load.push(`data modify storage ${store} chunk set value ${JSON.stringify(camera.frames.slice(f,f+128))}`);
                load.push(`data modify storage ${store} tracks.${camera.name} append from storage ${store} chunk[]`);
            }
        }
        load.push(`data remove storage ${store} chunk`);
        put('load', load);
        for (const [kind, value] of [['load',`${ns}:${base}/load`],['tick','objcubed:__camera/tick']]) {
            const path = `data/minecraft/tags/function/${kind}.json`;
            const tag = JSON.parse(files.get(path));
            if (!tag.values.includes(value)) tag.values.push(value);
            files.set(path, JSON.stringify(tag,null,2));
        }
        put('ensure', [
            'execute unless entity @s[type=minecraft:item_display,x_rotation=-0.001..0.001] run return 0',
            `execute unless score @s ${sb} matches -2147483648..2147483647 run scoreboard players set @s ${sb} 0`,
            'execute unless score @s oc.cam.id matches 1.. run scoreboard players add #next oc.cam.id 1',
            'execute unless score @s oc.cam.id matches 1.. run scoreboard players operation @s oc.cam.id = #next oc.cam.id',
            `tag @s add ${rootTag}`,
            'scoreboard players operation #root oc.cam.owner = @s oc.cam.id',
            ...cameras.flatMap(camera => [
                'scoreboard players set #found oc.cam.id 0',
                `execute as @e[type=minecraft:item_display,tag=${camTag}.${camera.name}] if score @s oc.cam.owner = #root oc.cam.owner run scoreboard players set #found oc.cam.id 1`,
                `execute if score #found oc.cam.id matches 0 summon minecraft:item_display run function ${ns}:${base}/${camera.name}/create`,
            ]),
            `function ${ns}:${base}/update`,
        ]);
        put('update', [
            'execute unless entity @s[x_rotation=-0.001..0.001] run return 0',
            'scoreboard players operation #root oc.cam.owner = @s oc.cam.id',
            `scoreboard players operation @s oc.cam.frame = @s ${sb}`,
            `execute if entity @s[tag=${id}.auto] run function ${ns}:${base}/loop_frame`,
            `execute if entity @s[tag=${id}.once] run function ${ns}:${base}/once_frame`,
            `scoreboard players operation @s oc.cam.frame %= #dur ${sb}`,
            `execute store result storage ${store} args.frame int 1 run scoreboard players get @s oc.cam.frame`,
            ...cameras.map(camera => `execute as @e[type=minecraft:item_display,tag=${camTag}.${camera.name}] if score @s oc.cam.owner = #root oc.cam.owner run function ${ns}:${base}/${camera.name}/select with storage ${store} args`),
        ]);
        put('loop_frame', [
            'execute store result score @s oc.cam.frame run time query gametime',
            `scoreboard players operation @s oc.cam.frame %= #cycle ${sb}`,
            `scoreboard players operation @s oc.cam.frame -= @s ${sb}`,
        ]);
        put('once_frame', [
            'execute store result score @s oc.cam.frame run time query gametime',
            `scoreboard players operation @s oc.cam.frame %= #cycle ${sb}`,
            `scoreboard players operation @s oc.cam.frame -= @s ${sb}`,
            'scoreboard players add @s oc.cam.frame 32768',
            `scoreboard players operation @s oc.cam.frame %= #cycle ${sb}`,
            `execute if score @s oc.cam.frame matches ${nframes}.. run scoreboard players set @s oc.cam.frame ${nframes-1}`,
        ]);
        for (const camera of cameras) {
            const name=camera.name, select=`@e[type=minecraft:item_display,tag=${camTag}.${name}]`;
            put(`${name}/create`, [
                `data merge entity @s {Tags:["oc.cam.entity","${camTag}","${camTag}.${name}"],teleport_duration:1,view_range:0f}`,
                'scoreboard players add #next oc.cam.id 1',
                'scoreboard players operation @s oc.cam.id = #next oc.cam.id',
                'scoreboard players operation @s oc.cam.owner = #root oc.cam.owner',
            ]);
            put(`${name}/select`, [
                `$data modify storage ${store} pose set from storage ${store} tracks.${name}[$(frame)]`,
                `function ${ns}:${base}/${name}/move with storage ${store} pose`,
            ]);
            put(`${name}/move`, ['$tp @s ^$(x) ^$(y) ^$(z) ~$(yaw) $(pitch)']);
            put(`${name}/start`, [
                'execute unless entity @s[type=minecraft:player] run return 0',
                'scoreboard players set #root oc.cam.owner -1',
                `execute summon minecraft:item_display run function ${ns}:${base}/start_root`,
                `function ${ns}:${base}/${name}/watch_ready`,
            ]);
            put(`${name}/watch`, [
                'execute unless entity @s[type=minecraft:player] run return 0',
                `execute unless entity @e[type=minecraft:item_display,tag=${ns}.${id},distance=..0.01,limit=1] run return 0`,
                'scoreboard players set #root oc.cam.owner -1',
                `execute as @e[type=minecraft:item_display,tag=${ns}.${id},distance=..0.01,sort=nearest,limit=1] at @s run function ${ns}:${base}/ensure`,
                `function ${ns}:${base}/${name}/watch_ready`,
            ]);
            // Both entry points retain the player executor and join the exact
            // root ID, including when another scene occupies the same position.
            put(`${name}/watch_ready`, [
                'execute unless entity @s[type=minecraft:player] run return 0',
                'execute unless score #root oc.cam.owner matches 1.. run return 0',
                'tag @e[tag=oc.cam.target] remove oc.cam.target',
                `execute as ${select} if score @s oc.cam.owner = #root oc.cam.owner run tag @s add oc.cam.target`,
                'execute unless entity @e[tag=oc.cam.target,limit=1] run return 0',
                'execute unless entity @s[tag=oc.cam.viewer] run function objcubed:__camera/save',
                'gamemode spectator @s',
                'scoreboard players operation @s oc.cam.view = @e[tag=oc.cam.target,limit=1] oc.cam.id',
                'tp @s @e[tag=oc.cam.target,limit=1]',
                'spectate @e[tag=oc.cam.target,limit=1] @s',
                'tag @e[tag=oc.cam.target] remove oc.cam.target',
            ]);
        }
        put('orphan', [
            'scoreboard players operation #root oc.cam.owner = @s oc.cam.owner',
            'scoreboard players set #found oc.cam.id 0',
            `execute as ${rootSelector} if score @s oc.cam.id = #root oc.cam.owner run scoreboard players set #found oc.cam.id 1`,
            'execute if score #found oc.cam.id matches 0 run kill @s',
        ]);
        // ponytail: loaded scene lookups are linear in roots × cameras. Index by
        // UUID if maps need large numbers of simultaneous camera rigs.
        put('tick', dims.flatMap(dim => [
            `execute in ${dim} as ${rootSelector} at @s rotated as @s run function ${ns}:${base}/update`,
            `execute in ${dim} as ${camSelector} run function ${ns}:${base}/orphan`,
        ]));
        put('end_view', [
            'scoreboard players operation #root oc.cam.owner = @s oc.cam.id',
            `execute as ${camSelector} if score @s oc.cam.owner = #root oc.cam.owner run function objcubed:__camera/end_view`,
        ]);
        put('remove', [
            `function ${ns}:${base}/end_view`,
            'scoreboard players operation #root oc.cam.owner = @s oc.cam.id',
            `execute as ${camSelector} if score @s oc.cam.owner = #root oc.cam.owner run kill @s`,
            `tag @s remove ${rootTag}`,
        ]);
        for (const name of ['zzz/_apply_auto','zzz/_apply_manual']) append(name,[`execute at @s rotated as @s run function ${ns}:${base}/ensure`]);
        append('zzz/_latch_once',[`execute at @s run function ${ns}:${base}/end_view`]);
        files.set(`data/${ns}/function/${id}/tick.mcfunction`, dims.map(dim =>
            `execute in ${dim} as ${rootSelector.slice(0,-1)},tag=${id}.once] run function ${ns}:${id}/zzz/_check_once`).concat(
            `function ${ns}:${base}/tick`).join('\n'));
        const spawnPath=`data/${ns}/function/${id}/summon.mcfunction`;
        const spawn = files.get(spawnPath).replace('billboard:"fixed",','billboard:"fixed",item_display:"fixed",');
        put('start_root', [
            spawn.replace('summon item_display ~ ~ ~ ', 'data merge entity @s '),
            `function ${ns}:${id}/play_once`,
        ]);
        files.set(`data/${ns}/function/${id}/start.mcfunction`, `function ${ns}:${base}/${cameras[0].name}/start`);
        files.set(spawnPath, spawn + '\n' +
            `execute as @e[type=minecraft:item_display,tag=${ns}.${id},tag=!${rootTag},distance=..0.01] run scoreboard players set @s ${sb} 0\n` +
            `execute as @e[type=minecraft:item_display,tag=${ns}.${id},tag=!${rootTag},distance=..0.01] at @s run function ${ns}:${id}/zzz/_apply_manual`);
        files.set('CAMERAS.txt', [
            'Cameras / Камеры — item_display scenes',
            'Run /reload after export. Keep the scene loaded.',
            'После экспорта: /reload. Держите сцену загруженной.',
            'START: as the viewer, creates a new scene here, plays once and enters the first exported camera.',
            'СТАРТ: от игрока — создаёт здесь новую сцену, запускает один раз и включает первую экспортированную камеру.',
            `function ${ns}:${id}/start`,
            'Specific camera / Выбрать камеру при старте:',
            ...cameras.map(c => `function ${ns}:${base}/${c.name}/start`),
            `Command block example / Пример для командного блока: execute as @p at @s run function ${ns}:${id}/start`,
            'Each start creates a separate scene. After playback the model stays on its last frame.',
            'Каждый start создаёт отдельную сцену. После просмотра модель остаётся на последнем кадре.',
            'WATCH: execute AS the viewer AT the chosen scene root. Multiple roots need an explicit selector.',
            'ПРОСМОТР: выполнять ОТ игрока В ПОЗИЦИИ выбранного корня сцены.',
            ...cameras.map(c => `execute as @p at @e[tag=${ns}.${id},sort=nearest,limit=1] run function ${ns}:${base}/${c.name}/watch`),
            'EXIT / ВЫХОД (as player / от игрока): function objcubed:__camera/exit',
            `REMOVE CAMERAS / УДАЛИТЬ КАМЕРЫ (as and at root / от корня в его позиции): function ${ns}:${base}/remove`,
            'play_once automatically returns viewers when it ends. stop freezes; it does not exit the view.',
            'play_once возвращает зрителей по завершении. stop останавливает движение без выхода из просмотра.',
            'Only position and yaw/pitch. FOV/roll are not exported. Upright fixed item_display; no custom entity transformation or billboard.',
            'Только положение и yaw/pitch. Без FOV/крена. Вертикальный item_display, вид «Рамка», без transformation/billboard сущности.',
            'One exported frame per tick; use 20 FPS for original timing. Loaded scenes in the three vanilla dimensions are supported.',
            'Один экспортированный кадр за тик; для исходной скорости используйте 20 FPS. Поддерживаются три стандартных измерения.',
        ].join('\n'));
    }

    function saveDatapackFiles(files, basePath) {
        const fs   = require('fs');
        const path = require('path');
        for (const [relPath, content] of files) {
            const fullPath = path.join(basePath, relPath);
            if (relPath === 'pack.mcmeta' && fs.existsSync(fullPath)) continue;
            const dir = path.dirname(fullPath);
            fs.mkdirSync(dir, { recursive: true });
            if (/tags\/function\/(tick|load)\.json$/.test(relPath) && fs.existsSync(fullPath)) {
                // merge our function into the existing tag (don't clobber other packs')
                let existing = {};
                try { existing = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch (e) {}
                const have = new Set(Array.isArray(existing.values) ? existing.values : []);
                for (const v of JSON.parse(content).values) have.add(v);
                fs.writeFileSync(fullPath, JSON.stringify({ values: [...have] }, null, 2), 'utf8');
                continue;
            }
            fs.writeFileSync(fullPath, content, 'utf8');
        }
    }

    // =========================================================
    // Section 11: Dialog
    // =========================================================
    function showDialog() {
        if (!Project) {
            Blockbench.showMessageBox({ title:'obj³', message: t('no_project') }); return;
        }
        if (!Texture.all.length) {
            Blockbench.showMessageBox({ title:'obj³', message: t('no_textures') }); return;
        }

        const hasAnims    = Animation.all.length > 0;
        // Closure state — kept outside Vue.data because Vue 2 doesn't proxy
        // _-prefixed names, which would silently break access from methods.
        let dialogDefaults = {};
        let suspendPersist = false;

        // Guided tour (issue #4) — non-reactive, closure-level alias of the
        // top-level TOUR_STEPS (single source of truth). sel is resolved
        // against this.$el at run time (sel:null = centered card; '__export__'
        // = the native dialog-bar Export button via .dialog). Exposed to the
        // template via the tourSteps() computed below. Keep the oc-tour-*
        // marker classes in the template in sync with these selectors.
        const tourSteps = TOUR_STEPS;

        const dialog = new Dialog({
            id:    PLUGIN_ID + '_dialog',
            title: t('dialog_title'),
            width: Math.min((typeof window !== 'undefined' ? window.innerWidth - 80 : Math.round(820 * UI_SCALE)), Math.round(820 * UI_SCALE)),
            component: {
                data() {
                    const firstAnim = Animation.all[0];
                    const hasArm = hasNonGeometryElements();
                    const state = {
                        // ---- Ephemeral (not persisted) ----
                        texOptions:    Texture.all.map((t,i)=>({label:t.name||`Texture ${i}`,value:i,thumb:t.source})),
                        multiTex:      Texture.all.length > 1,
                        animOptions:   Animation.all.map((a,i)=>({label:a.name||`Anim ${i}`,value:i})),
                        hasAnims,
                        hasArmature:   hasArm,
                        status: '',
                        statusKind: 'progress', // 'progress' | 'done' | 'error' | 'cancelled' — drives footer color
                        running: false,
                        // Guided tour (issue #4) — ephemeral, NOT persisted.
                        // tourActive gates the overlay; tourIndex points into the
                        // closure-level tourSteps. The "seen once" flag lives in
                        // localStorage('objcubed_tour_seen'), not in state.
                        tourActive: false,
                        tourIndex:  0,

                        // ---- Persisted (PERSISTABLE_FIELDS) ----
                        // Texture
                        selectedTex:   0,
                        useAtlas:      Texture.all.length > 1,
                        atlasTexChecked: Texture.all.map(() => true),
                        // Animated textures (issue #9): bake a vertical frame strip
                        texAnimEnabled: false,
                        texFrametime:  1,
                        texFade:       false,
                        // Transform
                        scale:         1,
                        offsetX:       0, offsetY: 0, offsetZ: 0,
                        // Animation
                        animationEnabled: false,
                        animationIndex:0,
                        animFps:       firstAnim ? (firstAnim.snapping||20) : 20,
                        animStart:     0,
                        animEnd:       firstAnim ? firstAnim.length : 0,
                        autoplay:      true,
                        // Datapack
                        generateDatapack: false,
                        exportCameras: false,
                        datapackNamespace: 'objcubed',
                        datapackAnimId:  (firstAnim ? (firstAnim.name || 'anim') : 'anim')
                            .replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 12) || 'anim',
                        datapackTargetType: 'equipment',
                        datapackEquipSlot: 'mainhand',
                        datapackOutputDir: '',
                        // Output paths
                        resourcePackDir: '',
                        outputMode: 'pack', filesOutputDir: '', modelOutputDir: '', textureOutputDir: '', textureResource: '',
                        customContexts: false, selectedContexts: [],
                        contextOptions: DISPLAY_SLOTS.map((id, i) => ({id, label: t(['tab_third','tab_left','tab_fpr','tab_fpl','tab_head','tab_gui','tab_ground','tab_fixed','tab_shelf'][i])})),
                        baseItem: 'iron_ingot',
                        // custom_model_data name — the string put on the base item
                        // to show the model. Defaults to the sanitized project name
                        // (same sanitization saveSingleOutput uses). This is the
                        // case key in the item override + the per-slot model base.
                        cmdName: (Project.name || 'model').replace(/[^a-z0-9_]/gi,'_').toLowerCase(),
                        // Equipment (armor) export — Approach C
                        exportAsEquipment: false,
                        equipmentTarget: 'humanoid',
                        equipmentSlot: 'chest',
                        selectedPieces: [],
                        // Base-item picker (ephemeral): registry list + dropdown state
                        itemList: [],
                        itemPickerOpen: false,
                        displayTab:    'third',   // display slot tab key
                        // Migration flag: true once the left hand was made separate
                        // (data() copies right->left for old mirroring projects).
                        useSeparateLefthand: false,
                        // Thirdperson rotation default 0° — no baked-in tilt.
                        // Earlier builds shipped a 5° X default (and legacy objmc
                        // projects an 85° one); both baked an unwanted rotation
                        // into the exported thirdperson display. Default is now
                        // identity; the user dials in any tilt explicitly.
                        dThirdRX: 0, dThirdRY: 0, dThirdRZ: 0,
                        dThirdTX: 0, dThirdTY: 0, dThirdTZ: 0,
                        dThirdSX: 1, dThirdSY: 1, dThirdSZ: 1,
                        // Display — Left hand (third-person, only used when useSeparateLefthand=true)
                        dLeftRX: 0, dLeftRY: 0, dLeftRZ: 0,
                        dLeftTX: 0, dLeftTY: 0, dLeftTZ: 0,
                        dLeftSX: 1, dLeftSY: 1, dLeftSZ: 1,
                        // Display — Head/Ground/Fixed
                        dHeadRX: 0, dHeadRY: 0, dHeadRZ: 0,
                        dHeadTX: 0, dHeadTY: 0, dHeadTZ: 0,
                        dHeadSX: 1, dHeadSY: 1, dHeadSZ: 1,
                        dGroundRX: 0, dGroundRY: 0, dGroundRZ: 0,
                        dGroundTX: 0, dGroundTY: 0, dGroundTZ: 0,
                        dGroundSX: 1, dGroundSY: 1, dGroundSZ: 1,
                        dFixedRX: 0, dFixedRY: 0, dFixedRZ: 0,
                        dFixedTX: 0, dFixedTY: 0, dFixedTZ: 0,
                        dFixedSX: 1, dFixedSY: 1, dFixedSZ: 1,
                        // Display — GUI (inventory)
                        dGuiRX: 0, dGuiRY: 0, dGuiRZ: 0,
                        dGuiTX: 0, dGuiTY: 0, dGuiTZ: 0,
                        dGuiSX: 1, dGuiSY: 1, dGuiSZ: 1,
                        // GUI rotation pivot, in BB units (16 = 1 block; 0 = origin
                        // = block centre in the decoded frame). 0/0/0 = auto: rotate
                        // about the block centre — vanilla's display pivot (any
                        // non-zero value overrides it). Encoder divides by 16 to the
                        // decoded block frame; the shader rotates the GUI display about it.
                        dGuiPX: 0, dGuiPY: 0, dGuiPZ: 0,
                        // Display — First-person right hand
                        dFprRX: 0, dFprRY: 0, dFprRZ: 0,
                        dFprTX: 0, dFprTY: 0, dFprTZ: 0,
                        dFprSX: 1, dFprSY: 1, dFprSZ: 1,
                        // Display — First-person left hand
                        dFplRX: 0, dFplRY: 0, dFplRZ: 0,
                        dFplTX: 0, dFplTY: 0, dFplTZ: 0,
                        dFplSX: 1, dFplSY: 1, dFplSZ: 1,
                        // Display — On shelf
                        dShelfRX: 0, dShelfRY: 0, dShelfRZ: 0,
                        dShelfTX: 0, dShelfTY: 0, dShelfTZ: 0,
                        dShelfSX: 1, dShelfSY: 1, dShelfSZ: 1,
                        // Color & Tinting
                        cbR: 'direct', cbG: 'direct', cbB: 'direct',
                        // Advanced
                        easing:        1,
                        interpolation: 1,
                        autorotate:    3,
                        flipuv:        false,
                        noshadow:      false,
                        // Default to PoT padding ON: the encoder/shader layout is
                        // already PoT-independent (header encodes the DATA height,
                        // shader normalizes by the real atlasSize, so padding is
                        // cosmetic blank rows that never shift sampled texels), but
                        // an NPOT *PNG* still gets refused by old GPUs/drivers and
                        // shows up as the intermittent "broken model" symptom. PoT
                        // by default renders everywhere; users who know their GPU
                        // handles NPOT can tick the box to reclaim the space.
                        nopow:         false,
                        filterArmature: hasArm,
                    };

                    // Snapshot of the freshly-built defaults — stashed on the
                    // closure (NOT on Vue state) because Vue 2 doesn't proxy
                    // property names starting with _ or $, which would silently
                    // leave them undefined when accessed as this._defaults.
                    dialogDefaults = {};
                    for (const k of PERSISTABLE_FIELDS) dialogDefaults[k] = state[k];

                    // Overlay any persisted values from the active preset.
                    const persisted = loadActiveSettings();
                    if (persisted) {
                        for (const k of PERSISTABLE_FIELDS) {
                            if (Object.prototype.hasOwnProperty.call(persisted, k)) {
                                state[k] = persisted[k];
                            }
                        }
                        // Legacy migration: old projects persisted thirdperson
                        // rotation X as 85° (objmc convention) or 5° (an earlier
                        // build's default). Both baked an unwanted tilt. New
                        // default is 0° (no rotation). Normalize 85 and 5 → 0
                        // silently so old projects don't keep the stale tilt.
                        if (state.dThirdRX === 85 || state.dThirdRX === 5) state.dThirdRX = 0;
                        if (state.dLeftRX  === 85 || state.dLeftRX  === 5) state.dLeftRX  = 0;

                        // Persistence-boundary coercion: a corrupt/hand-edited
                        // .bbmodel may persist array fields as non-arrays; restore
                        // the freshly-built default so no downstream .map/.some/
                        // index read can throw (closes the atlasTexChecked class).
                        for (const k of ['atlasTexChecked', 'selectedPieces']) {
                            if (!Array.isArray(state[k])) state[k] = dialogDefaults[k];
                        }
                    }

                    state.modelOutputDir ||= state.filesOutputDir;
                    state.textureOutputDir ||= state.filesOutputDir;
                    if (state.equipmentTarget !== 'humanoid' && !Object.prototype.hasOwnProperty.call(ANIMAL_EQUIPMENT,state.equipmentTarget))
                        state.equipmentTarget = 'humanoid';

                    // Migration: the third-person left hand used to MIRROR the right
                    // unless useSeparateLefthand was ticked. The toggle is gone (the
                    // left tab is always separate) — for projects that mirrored, copy
                    // the right-hand values over once; the flag marks migration done.
                    if (state.useSeparateLefthand !== true) {
                        for (const ax of ['RX','RY','RZ','TX','TY','TZ','SX','SY','SZ'])
                            state['dLeft' + ax] = state['dThird' + ax];
                        state.useSeparateLefthand = true;
                    }

                    // Sync animEnd with the current animation length only when the
                    // persisted trim is unset/invalid or exceeds the clip — a saved
                    // end-trim must survive a dialog reopen (animStart already does).
                    const curAnim = Animation.all[state.animationIndex];
                    if (curAnim && (!(state.animEnd > state.animStart) || state.animEnd > curAnim.length))
                        state.animEnd = curAnim.length;

                    suspendPersist = false;
                    return state;
                },
                created() {
                    // Auto-save every persisted field to Project.objcubed_data
                    // on change. This means closing the project after just
                    // opening the dialog is enough to preserve current settings.
                    const persist = () => {
                        if (suspendPersist) return;
                        const snap = {};
                        for (const k of PERSISTABLE_FIELDS) snap[k] = this[k];
                        saveActiveSettings(snap);
                    };
                    for (const k of PERSISTABLE_FIELDS) {
                        this.$watch(k, persist, { deep: true });
                    }
                },
                mounted() {
                    // Base-item registry for the picker (cached; silent offline fallback).
                    this.loadItemList();
                    // If the user just came back from BB's Display editor, pull their
                    // edits (Project.display_settings) into the dialog so they reach the
                    // export. One-shot flag set by openInDisplayEditor; cleared here.
                    // Session-scoped + project-checked (was localStorage: a machine-
                    // global flag survived restarts and fired in OTHER projects,
                    // clobbering their display fields with the wrong project's data).
                    try {
                        if (pullDisplayForProject && typeof Project !== 'undefined' && Project
                            && Project.uuid === pullDisplayForProject) {
                            this._loadFromDisplaySettings();
                        }
                        pullDisplayForProject = null;
                    } catch (e) {}
                    // Tooltip portal — single floating element repositioned per hover.
                    // Lives on document.body so it never gets clipped by the dialog.
                    let tip = document.getElementById('oc-tooltip-portal');
                    if (!tip) {
                        tip = document.createElement('div');
                        tip.id = 'oc-tooltip-portal';
                        tip.className = 'oc-tooltip';
                        tip.setAttribute('role', 'tooltip');
                        document.body.appendChild(tip);
                    }
                    // Tooltip lives outside .oc-root, so it can't inherit the
                    // scale var — set it explicitly to the fixed UI scale.
                    tip.style.setProperty('--oc-scale', UI_SCALE);
                    this._tipEl = tip;
                    const show = (target) => {
                        const text = target.getAttribute('data-tip');
                        if (!text) return;
                        tip.textContent = text;
                        target.setAttribute('aria-describedby', tip.id);
                        // Reset positioning so measurement is clean
                        tip.style.left = '0px';
                        tip.style.top  = '0px';
                        tip.classList.add('visible');
                        // Measure
                        const r = target.getBoundingClientRect();
                        const t = tip.getBoundingClientRect();
                        const pad = 6, edge = 8;
                        let left = r.left + r.width/2 - t.width/2;
                        let top  = r.top  - t.height - pad;
                        // Keep inside viewport
                        if (left < edge) left = edge;
                        if (left + t.width > window.innerWidth - edge)
                            left = window.innerWidth - edge - t.width;
                        if (top < edge) top = r.bottom + pad;  // flip below
                        tip.style.left = left + 'px';
                        tip.style.top  = top  + 'px';
                    };
                    const hide = () => tip.classList.remove('visible');
                    for(const event of ['mouseover','focusin']) this.$el.addEventListener(event, (e) => {
                        const t = e.target.closest('[data-tip]');
                        if (t && this.$el.contains(t)) show(t);
                    });
                    for(const event of ['mouseout','focusout']) this.$el.addEventListener(event, (e) => {
                        const t = e.target.closest('[data-tip]');
                        if (t) hide();
                    });
                    // Style the Export button in the dialog bar
                    this.$nextTick(() => {
                        const dlg = this.$el.closest('.dialog');
                        if (dlg) {
                            const btns = dlg.querySelectorAll('.dialog_bar button');
                            if (btns[0]) {
                                btns[0].style.cssText = 'background:rgba(90,140,192,0.25);color:#cde;font-weight:600;border:none;border-radius:4px;padding:6px 24px;';
                            }
                        }
                        // Issue #10: the in-dialog 3D preview was removed (BB's
                        // renderer renders blank inside a modal). Opening the dialog
                        // no longer switches the app into Display mode; the new
                        // "Open in Blockbench Display editor" button does that
                        // explicitly on demand (see openInDisplayEditor).

                        // Issue #4: auto-show the guided tour the first time this
                        // dialog ever opens on this machine. The "seen" flag is a
                        // single localStorage key; the header ? button replays it.
                        let seen = true;
                        try { seen = !!localStorage.getItem('objcubed_tour_seen'); } catch (e) {}
                        if (!seen) this.$nextTick(() => this.startTour());
                    });
                },
                beforeDestroy() {
                    const tip = document.getElementById('oc-tooltip-portal');
                    if (tip) tip.remove();
                    // Issue #10: no in-dialog preview anymore — nothing GL/RAF to
                    // dispose. Opening the dialog no longer touches editor state.
                    // Issue #4: the tour overlay is rendered inside this.$el via
                    // v-if, so Vue tears it down with the component. Nothing extra
                    // to remove, but guard against any stray nodes if a future
                    // refactor portals them out.
                    // Closing mid-tour (Close/Esc) bypasses tourEnd, which is the only
                    // place that restored fields a tour step force-revealed (animationEnabled,
                    // generateDatapack, exportAsEquipment…). Without this they'd persist
                    // forced-ON to the project. Mirror tourEnd's restore + persist explicitly
                    // (the field watcher may not flush during teardown).
                    if (this._tourSaved) {
                        for (const k in this._tourSaved) this[k] = this._tourSaved[k];
                        this._tourSaved = null;
                        const snap = {};
                        for (const k of PERSISTABLE_FIELDS) snap[k] = this[k];
                        saveActiveSettings(snap);
                    }
                    this.tourActive = false;
                },
                computed: {
                    isHorseEquipment() { return !!equipmentOf(this); },
                    animalTargets() { return Object.values(ANIMAL_EQUIPMENT).filter(e=>EQUIPMENT_CARRIERS[e.layer]).map(e=>({id:e.layer,label:equipmentLabel(e.labels)})); },
                    animalPartLabels() { return Object.keys(equipmentParts(this)).map(p=>equipmentLabel(EQUIPMENT_PART_LABELS[p] || [p,p])).join(', '); },
                    horseLayerCount() { return Math.ceil(this.previewFaceCount / 6); },
                    animalBindingsHelp() { return this.help('animalBindings') + ' ' + this.help('equipmentLayers')
                        + ' ' + t('lbl_equipment_layers') + ': ' + this.horseLayerCount + '.'; },
                    animalDatapackTarget() { return equipmentLabel(equipmentOf(this).labels); },
                    // Issue #4: expose the closure-level (non-reactive) tour step
                    // list to the template. tourActive/tourIndex (reactive) drive
                    // which step renders; the array itself never changes.
                    tourSteps() { return hasAnims ? tourSteps : tourSteps.filter(s => !s.requiresAnims); },
                    showDatapackOption() {
                        return this.outputMode !== 'files' && this.hasAnims && this.animationEnabled;
                    },
                    selectedTexThumb() {
                        const tex = Texture.all[this.selectedTex];
                        return tex ? tex.source : '';
                    },
                    // Issue #10: is BlockBench's real Display mode usable for the
                    // Enabled whenever a project is open. BB normally gates its
                    // Display mode behind Format.display_mode, but openInDisplayEditor
                    // force-enables that flag for the session, so the button stays
                    // usable even for formats (Generic/free) that leave it off.
                    displayModeAvailable() {
                        return typeof Project !== 'undefined' && !!Project;
                    },
                    // ── Base-item picker ──
                    filteredItems() {
                        if (!this.itemList.length) return [];
                        const q = String(this.baseItem || '').toLowerCase().trim();
                        const hits = q ? this.itemList.filter(i => i.includes(q)) : this.itemList;
                        return hits.slice(0, 60); // keep the dropdown light
                    },
                    baseItemKnown() {
                        return this.itemList.includes(String(this.baseItem || '').toLowerCase().trim());
                    },
                    // Frames the anim UI reveals on. Single texture: the selected
                    // texture's strip count. Atlas: the LARGEST strip among the
                    // checked atlas textures, so the
                    // control appears in atlas mode too (where selectedTex is hidden).
                    texFrameCount() {
                        const framesOf = (tex) => {
                            if (!tex) return 1;
                            const w = (tex.img && tex.img.naturalWidth)  || tex.width  || 16;
                            const h = (tex.img && tex.img.naturalHeight) || tex.height || 16;
                            if (w < 1 || h < 1) return 1;
                            try { return h / textureFrameHeight(tex, w, h, true); }
                            catch (_) { return Math.max(2, Number(tex.frameCount) || 2); }
                        };
                        if (this.useAtlas) {
                            const counts = atlasTexIndicesFrom(this.atlasTexChecked)
                                .map(i => framesOf(Texture.all[i]));
                            return counts.length ? Math.max(1, ...counts) : 1;
                        }
                        return framesOf(Texture.all[this.selectedTex]);
                    },
                    frameCountPreview() {
                        if (!this.hasAnims || !this.animationEnabled) return '';
                        const fps = +this.animFps || 1;
                        const start = +this.animStart || 0;
                        const end = +this.animEnd || 0;
                        if (end <= start) return '';
                        const n = frameCountOf(start, end, fps);
                        return n + ' ' + tPlural(n, 'frames');
                    },
                    // Auto-computed duration in ticks (1 tick = 1/20 s).
                    // Shown instead of the manual input now.
                    durationTicksAuto() {
                        const start = +this.animStart || 0;
                        const end   = +this.animEnd || 0;
                        if (end <= start) return 0;
                        return Math.max(1, Math.round((end - start) * 20));
                    },
                    // ---- Preview banner ----
                    previewFaceCount() {
                        return estimateFaceCount(!!this.filterArmature);
                    },
                    previewFrameCount() {
                        if (!this.hasAnims || !this.animationEnabled) return 1;
                        const fps = +this.animFps || 1;
                        const start = +this.animStart || 0;
                        const end = +this.animEnd || 0;
                        if (end <= start) return 1;
                        return frameCountOf(start, end, fps);
                    },
                    previewTexSize() {
                        // Returns {w, h} based on current texture/atlas choice.
                        if (this.useAtlas) {
                            // Array-guarded via atlasTexIndicesFrom so a corrupt/hand-edited
                            // project whose persisted atlasTexChecked is a non-array doesn't
                            // make this computed throw `TypeError: …map is not a function`
                            // (final-review fix; same class as C1/C3).
                            const selected = atlasTexIndicesFrom(this.atlasTexChecked)
                                .map(i => Texture.all[i])
                                .filter(Boolean);
                            if (!selected.length) return null;
                            let w = 0, h = 0;
                            for (const t of selected) {
                                const tw = (t.img && t.img.naturalWidth) || t.width || 16;
                                const th = (t.img && t.img.naturalHeight) || t.height || 16;
                                if (tw > w) w = tw;
                                h += th;
                            }
                            return { w, h };
                        }
                        const tex = Texture.all[this.selectedTex];
                        if (!tex) return null;
                        return {
                            w: (tex.img && tex.img.naturalWidth) || tex.width || 16,
                            h: (tex.img && tex.img.naturalHeight) || tex.height || 16,
                        };
                    },
                    previewPngSize() {
                        const ts = this.previewTexSize;
                        if (!ts) return null;
                        return estimateOutputPng(this.previewFaceCount, this.previewFrameCount,
                                                  ts.w, ts.h, !!this.nopow);
                    },
                    previewPngSizePretty() {
                        const e = this.previewPngSize;
                        if (!e) return '';
                        const kb = e.approxBytes / 1024;
                        if (kb < 1) return `~${e.approxBytes} ${t('unit_b')}`;
                        if (kb < 1024) return `~${kb.toFixed(1)} ${t('unit_kb')}`;
                        return `~${(kb/1024).toFixed(2)} ${t('unit_mb')}`;
                    },
                    previewWarnings() {
                        const w = [];
                        if (this.previewFaceCount === 0) {
                            w.push({ level:'error', msg: t('warn_model_empty') });
                            return w;
                        }
                        if (this.previewFaceCount > 20000) {
                            w.push({ level:'warn',
                                msg: t('warn_too_many_faces').replace('{n}', this.previewFaceCount) });
                        }
                        const ts = this.previewTexSize;
                        if (ts && ts.w > 512) {
                            w.push({ level:'warn',
                                msg: t('warn_tex_wide').replace('{w}', ts.w) });
                        }
                        if (ts && ts.w < 8) {
                            w.push({ level:'error',
                                msg: t('warn_tex_narrow').replace('{w}', ts.w) });
                        }
                        if (this.filterArmature && !this.hasArmature) {
                            w.push({ level:'warn',
                                msg: t('warn_filter_no_armature') });
                        }
                        if (this.useAtlas && this.multiTex && !(Array.isArray(this.atlasTexChecked) && this.atlasTexChecked.some(v=>v))) {
                            w.push({ level:'error', msg: t('warn_atlas_empty') });
                        }
                        // Validate each source texture using the exporter's frame
                        // contract; the combined atlas aspect says nothing about frames.
                        if (this.texAnimEnabled) {
                            const selected = this.useAtlas
                                ? atlasTexIndicesFrom(this.atlasTexChecked).map(i => Texture.all[i])
                                : [Texture.all[this.selectedTex]];
                            for (const tex of selected.filter(Boolean)) {
                                const tw = (tex.img && tex.img.naturalWidth) || tex.width || 16;
                                const th = (tex.img && tex.img.naturalHeight) || tex.height || 16;
                                try { textureFrameHeight(tex, tw, th, true, !this.useAtlas); }
                                catch (_) {
                                    w.push({ level:'error', msg: t('warn_tex_strip_ratio').replace('{w}', tw).replace('{h}', th) });
                                }
                            }
                        }
                        return w;
                    },
                    // Color & Tinting: pretty description of what each channel does.
                    colorBehaviorPretty() {
                        const effective = this.generateDatapack && this.showDatapackOption
                            ? ['time','time','time'] : [this.cbR, this.cbG, this.cbB];
                        if (effective.every(v => v === 'direct'))
                            return t('color_all_direct');
                        if (effective.every(v => v === 'time'))
                            return t('color_all_time');
                        if (effective.every(v => v === 'scale'))
                            return t('color_all_scale');
                        if (effective.every(v => v === 'overlay'))
                            return t('color_all_overlay');
                        if (effective.every(v => v === 'hurt'))
                            return t('color_all_hurt');
                        // Mixed combo — no summary (the per-button labels already tell the user).
                        return '';
                    },
                    // Which preset (if any) the current R/G/B combo matches.
                    colorBehaviorPreset() {
                        const k = `${this.cbR}/${this.cbG}/${this.cbB}`;
                        return ({
                            'direct/direct/direct': 'tint',
                            'time/time/time':       'anim',
                            'scale/scale/scale':    'scale',
                            'overlay/overlay/overlay': 'overlay',
                            'hurt/hurt/hurt':       'hurt',
                        })[k] || null;
                    },
                    // True if the datapack-mode side-effects override user color settings.
                    colorBehaviorForcedByDatapack() {
                        return this.generateDatapack && this.showDatapackOption;
                    },
                    validationErrors() {
                        const errs = [];
                        if (this.useAtlas && this.multiTex && !(Array.isArray(this.atlasTexChecked) && this.atlasTexChecked.some(v => v)))
                            errs.push({ field:'atlas', msg: t('err_atlas_none') });
                        // (removed: orphaned scale<=0 validation — `scale` has no UI input,
                        // so this was an unrecoverable dead-end for legacy/corrupt persisted
                        // values; the encoder coerces a non-positive scale to 1 instead.)
                        if (this.hasAnims && this.animationEnabled) {
                            if (+this.animEnd <= +this.animStart)
                                errs.push({ field:'animEnd', msg: t('err_end_before_start') });
                            if (+this.animFps < 1)
                                errs.push({ field:'animFps', msg: t('err_fps_min') });
                            else if (+this.animFps > 60)
                                errs.push({ field:'animFps', msg: t('err_fps_max') });
                        }
                        if (this.generateDatapack && this.showDatapackOption) {
                            if (!this.datapackAnimId.trim())
                                errs.push({ field:'datapackAnimId', msg: t('err_need_anim_id') });
                            if (!this.datapackNamespace.trim())
                                errs.push({ field:'datapackNamespace', msg: t('err_need_namespace') });
                        }
                        return errs;
                    },
                    fieldErrorMap() {
                        const m = {};
                        for (const e of this.validationErrors) m[e.field] = e.msg;
                        return m;
                    },
                    errorBadgeTitle() {
                        return this.validationErrors.map(e => '• ' + e.msg).join('\n');
                    },
                },
                watch: {
                    outputMode(value) {
                        if (value === 'files') {
                            this.exportAsEquipment = false; this.generateDatapack = false; this.exportCameras = false;
                            if (!this.customContexts) { this.customContexts = true; this.selectedContexts = []; }
                        }
                    },
                    // No implicit side-effects on generateDatapack toggle —
                    // the dialog now shows an explicit notice and the export
                    // path applies time/time/time + autoplay=false in doExport.
                    animationEnabled(val) {
                        if (!val) return;
                        const anim = Animation.all[this.animationIndex];
                        if (!anim) return;
                        if (+this.animEnd <= +this.animStart) {
                            this.animFps   = anim.snapping || this.animFps || 20;
                            this.animStart = 0;
                            this.animEnd   = anim.length || this.animEnd;
                            this.datapackAnimId = (anim.name || 'anim')
                                .replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 12) || 'anim';
                        }
                    },
                },
                methods: {
                    t(key) { return t(key); },
                    tPlural(n, key) { return tPlural(n, key); },
                    help(k) { return t('help_' + k) || ''; },
                    hasErr(field) { return !!this.fieldErrorMap[field]; },
                    // ── Guided tour (issue #4) ────────────────────────────
                    // Coach-mark tour over the real dialog elements. One spotlight
                    // engine (positionTour) dims the dialog and cuts a hole over
                    // the current step's target; a card narrates. Replayable via
                    // the header ? button; auto-shown once (mounted gate).
                    startTour() {
                        this.tourIndex = 0;
                        this.tourActive = true;
                        this.applyTourReveal();
                        this.$nextTick(() => this.positionTour());
                    },
                    tourNext() {
                        if (this.tourIndex >= this.tourSteps.length - 1) { this.tourEnd(true); return; }
                        this.tourIndex++;
                        this.applyTourReveal();
                        this.$nextTick(() => this.positionTour());
                    },
                    tourPrev() {
                        if (this.tourIndex <= 0) return;
                        this.tourIndex--;
                        this.applyTourReveal();
                        this.$nextTick(() => this.positionTour());
                    },
                    // Some steps anchor to controls inside a toggled-off section
                    // (autoplay/datapack need animationEnabled). Turn the section on
                    // before measuring so its anchor exists; restored in tourEnd.
                    applyTourReveal() {
                        const step = this.tourSteps[this.tourIndex];
                        if (!step || !step.reveal) return;
                        if (!this._tourSaved) this._tourSaved = {};
                        for (const k in step.reveal) {
                            if (!(k in this._tourSaved)) this._tourSaved[k] = this[k];
                            this[k] = step.reveal[k];
                        }
                    },
                    // Snap texFrametime back to a valid >=1 integer (min= only guards the
                    // spinner; a typed 0/-5 otherwise lingers in the field while export clamps).
                    clampTexFrametime() { this.texFrametime = Math.max(1, Math.round(+this.texFrametime || 1)); },
                    // ── Base-item picker (registry from the mcasset mirror) ──
                    itemIconUrl(id) {
                        return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${MC_ASSETS_VERSION}/assets/minecraft/textures/item/${id}.png`;
                    },
                    pickBaseItem(id) { this.baseItem = id; this.itemPickerOpen = false; },
                    // mousedown on a row is .prevent-ed so blur fires AFTER the pick;
                    // small delay covers scrollbar drags inside the list.
                    closeItemPicker() { setTimeout(() => { this.itemPickerOpen = false; }, 150); },
                    async loadItemList() {
                        const KEY = 'objcubed_item_list_' + MC_ASSETS_VERSION;
                        try {
                            const cached = localStorage.getItem(KEY);
                            if (cached) { this.itemList = JSON.parse(cached); return; }
                        } catch (e) {}
                        try {
                            const r = await fetch(`https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${MC_ASSETS_VERSION}/assets/minecraft/items/_list.json`);
                            if (!r.ok) return; // offline / mirror down -> plain text input
                            const j = await r.json();
                            const list = (j.files || [])
                                .filter(f => f.endsWith('.json'))
                                .map(f => f.slice(0, -5));
                            if (list.length) {
                                this.itemList = list;
                                try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
                            }
                        } catch (e) { /* offline -> plain text input */ }
                    },
                    // Vue 2 can't track assignment to an array index (atlasTexChecked[i] = v),
                    // so the index-bound v-model left dependent computeds (previewTexSize,
                    // previewWarnings, validationErrors) stale; $set restores reactivity.
                    setAtlasChecked(i, val) { this.$set(this.atlasTexChecked, i, val); },
                    tourEnd(persistSeen) {
                        this.tourActive = false;
                        // Restore anything a step revealed (e.g. animationEnabled).
                        if (this._tourSaved) {
                            for (const k in this._tourSaved) this[k] = this._tourSaved[k];
                            this._tourSaved = null;
                        }
                        if (persistSeen) {
                            try { localStorage.setItem('objcubed_tour_seen', '1'); } catch (e) {}
                        }
                    },
                    // Resolve the current step's target and place the spotlight
                    // hole + card. sel:null centers the card with no hole. Missing
                    // targets are skipped (card centered). Forces the third-person
                    // tab visible before measuring its v-show-gated row.
                    positionTour() {
                        if (!this.tourActive) return;
                        const step = this.tourSteps[this.tourIndex];
                        const hole = this.$el && this.$el.ownerDocument
                            ? this.$el.ownerDocument.getElementById('oc-tour-hole') : null;
                        const card = this.$el && this.$el.ownerDocument
                            ? this.$el.ownerDocument.getElementById('oc-tour-card') : null;
                        if (!card) return;
                        const vw = window.innerWidth, vh = window.innerHeight;
                        // position:fixed is viewport-relative UNLESS an ancestor establishes a
                        // containing block (transform/filter/perspective/will-change/contain) —
                        // some custom BlockBench themes do this on the dialog, which makes the
                        // tour spotlight + card drift sideways. Find that ancestor and convert
                        // our viewport coords into it (cbOff = {0,0} for the default theme).
                        const cbOff = (() => {
                            let p = card.parentElement;
                            while (p && p.nodeType === 1) {
                                const s = getComputedStyle(p);
                                if ((s.transform && s.transform !== 'none') ||
                                    (s.filter && s.filter !== 'none') ||
                                    (s.perspective && s.perspective !== 'none') ||
                                    /transform|filter|perspective/.test(s.willChange || '') ||
                                    /paint|layout|strict|content/.test(s.contain || '')) {
                                    const r = p.getBoundingClientRect();
                                    return { x: r.left, y: r.top };
                                }
                                p = p.parentElement;
                            }
                            return { x: 0, y: 0 };
                        })();
                        // No spotlight: center the card.
                        const center = () => {
                            // Full dim, no spotlight cutout: a 0x0 hole at the screen
                            // centre whose 9999px box-shadow darkens everything; hide
                            // the ring so no dot shows. (Fixes the un-dimmed welcome.)
                            if (hole) {
                                hole.style.display = 'block';
                                hole.style.outline = 'none';
                                hole.style.left   = Math.round(vw / 2 - cbOff.x) + 'px';
                                hole.style.top    = Math.round(vh / 2 - cbOff.y) + 'px';
                                hole.style.width  = '0px';
                                hole.style.height = '0px';
                            }
                            const cr = card.getBoundingClientRect();
                            card.style.left = Math.round((vw - cr.width) / 2 - cbOff.x) + 'px';
                            card.style.top  = Math.round((vh - cr.height) / 2 - cbOff.y) + 'px';
                        };
                        if (!step || !step.sel) { center(); return; }
                        let target = null;
                        if (step.sel === '__export__') {
                            const dlg = this.$el && this.$el.closest('.dialog');
                            target = dlg ? dlg.querySelector('.dialog_bar button') : null;
                        } else {
                            target = this.$el ? this.$el.querySelector(step.sel) : null;
                        }
                        if (!target) { center(); return; }
                        // Smooth-scroll the target into view so the window glides
                        // instead of teleporting when the next step is below the fold.
                        try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
                        // Re-measure each frame; place() reads the live rect.
                        const place = () => {
                            const r = target.getBoundingClientRect();
                            const pad = 6;
                            if (hole) {
                                hole.style.display = 'block';
                                hole.style.outline = '';  // restore the CSS spotlight ring
                                hole.style.left   = (r.left - pad - cbOff.x) + 'px';
                                hole.style.top    = (r.top - pad - cbOff.y) + 'px';
                                hole.style.width  = (r.width + pad * 2) + 'px';
                                hole.style.height = (r.height + pad * 2) + 'px';
                            }
                            // Place the card beside the spotlight: pick the side
                            // (below/above the target) with more room so it never
                            // flips into a cramped corner, then clamp fully inside
                            // the viewport on BOTH axes so it can't fly off-screen.
                            const cr = card.getBoundingClientRect();
                            const edge = 10, gap = 12;
                            const roomBelow = vh - r.bottom - gap;
                            const roomAbove = r.top - gap;
                            let top = (roomBelow >= cr.height || roomBelow >= roomAbove)
                                ? r.bottom + gap
                                : r.top - gap - cr.height;
                            let left = r.left + r.width / 2 - cr.width / 2;
                            top  = Math.max(edge, Math.min(top,  vh - cr.height - edge));
                            left = Math.max(edge, Math.min(left, vw - cr.width  - edge));
                            card.style.left = Math.round(left - cbOff.x) + 'px';
                            card.style.top  = Math.round(top - cbOff.y) + 'px';
                        };
                        // Smooth scroll is async AND eases in slowly, so a naive
                        // "stabilized" check trips on the slow first frames and pins
                        // the hole to the pre-scroll position (spotlight lands on the
                        // wrong element). FOLLOW the scroll, re-placing every frame,
                        // and only treat it as settled AFTER it has actually moved
                        // (or, when no scroll was needed, after a short grace period).
                        if (typeof requestAnimationFrame === 'function') {
                            let prevTop = NaN, settled = 0, frames = 0, moved = false;
                            const follow = () => {
                                if (!this.tourActive) return;
                                place();
                                const top = target.getBoundingClientRect().top;
                                if (!Number.isNaN(prevTop)) {
                                    if (Math.abs(top - prevTop) >= 0.5) { moved = true; settled = 0; }
                                    else settled++;
                                }
                                prevTop = top;
                                const done = (moved && settled >= 3)    // scrolled, now stable
                                          || (!moved && settled >= 12)   // never scrolled (already in view)
                                          || ++frames >= 90;             // hard cap ~1.5s
                                if (done) { place(); return; }
                                requestAnimationFrame(follow);
                            };
                            requestAnimationFrame(follow);
                        } else {
                            place();
                        }
                    },
                    startDrag(event, field, step) {
                        const input = event.currentTarget.querySelector('input');
                        const startX = event.clientX;
                        const startVal = parseFloat(this[field]) || 0;
                        const s = step || 1;
                        let dragged = false;
                        const onMove = (e) => {
                            const dx = e.clientX - startX;
                            if (!dragged && Math.abs(dx) < 3) return;
                            dragged = true;
                            e.preventDefault();
                            input.blur();
                            this[field] = Math.round((startVal + dx * s) * 100) / 100;
                            document.body.style.cursor = 'ew-resize';
                            document.body.style.userSelect = 'none';
                        };
                        const onUp = () => {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                            document.body.style.cursor = '';
                            document.body.style.userSelect = '';
                            if (!dragged) { input.focus(); input.select(); }
                        };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                    },
                    closeDialog() { if (dialog) dialog.close(); },
                    // Map a dialog tab id to BlockBench's display-slot key.
                    _slotKeyFor(tab) {
                        return ({
                            third:  'thirdperson_righthand',
                            fpr:    'firstperson_righthand',
                            fpl:    'firstperson_lefthand',
                            head:   'head',
                            gui:    'gui',
                            ground: 'ground',
                            fixed:  'fixed',
                            shelf:  'on_shelf',
                        })[tab] || 'thirdperson_righthand';
                    },
                    // Per-slot transforms from the dialog's d* fields, keyed by BB
                    // display-slot key, in BB / vanilla units (deg, 1/16 block, mult).
                    // Same d*->{rotation,translation,scale} mapping the export path
                    // (doExport.cfg.displaySlots) uses, so BB's editor shows exactly
                    // what the dialog has set. lefthand always mirrors thirdperson.
                    _dialogSlotTransforms() {
                        const v = (k) => +this[k] || 0;
                        // Scale: blank/garbage -> 1, but a TYPED 0 stays 0 (the
                        // standard vanilla trick to hide an item in a display slot;
                        // `|| 1` would silently un-hide it).
                        const sv = (k) => {
                            const raw = this[k];
                            if (raw === '' || raw == null) return 1;
                            const n = +raw;
                            return Number.isFinite(n) ? n : 1;
                        };
                        const third = {
                            rotation:    [v('dThirdRX'), v('dThirdRY'), v('dThirdRZ')],
                            translation: [v('dThirdTX'), v('dThirdTY'), v('dThirdTZ')],
                            scale:       [sv('dThirdSX'), sv('dThirdSY'), sv('dThirdSZ')],
                        };
                        return {
                            thirdperson_righthand: third,
                            // Always separate (the mirror-right toggle is gone);
                            // old mirroring projects are migrated in data().
                            thirdperson_lefthand: {
                                rotation:    [v('dLeftRX'), v('dLeftRY'), v('dLeftRZ')],
                                translation: [v('dLeftTX'), v('dLeftTY'), v('dLeftTZ')],
                                scale:       [sv('dLeftSX'), sv('dLeftSY'), sv('dLeftSZ')],
                            },
                            firstperson_righthand: {
                                rotation:    [v('dFprRX'), v('dFprRY'), v('dFprRZ')],
                                translation: [v('dFprTX'), v('dFprTY'), v('dFprTZ')],
                                scale:       [sv('dFprSX'), sv('dFprSY'), sv('dFprSZ')],
                            },
                            firstperson_lefthand: {
                                rotation:    [v('dFplRX'), v('dFplRY'), v('dFplRZ')],
                                translation: [v('dFplTX'), v('dFplTY'), v('dFplTZ')],
                                scale:       [sv('dFplSX'), sv('dFplSY'), sv('dFplSZ')],
                            },
                            head: {
                                rotation:    [v('dHeadRX'), v('dHeadRY'), v('dHeadRZ')],
                                translation: [v('dHeadTX'), v('dHeadTY'), v('dHeadTZ')],
                                scale:       [sv('dHeadSX'), sv('dHeadSY'), sv('dHeadSZ')],
                            },
                            gui: {
                                rotation:    [v('dGuiRX'), v('dGuiRY'), v('dGuiRZ')],
                                translation: [v('dGuiTX'), v('dGuiTY'), v('dGuiTZ')],
                                scale:       [sv('dGuiSX'), sv('dGuiSY'), sv('dGuiSZ')],
                                // (No pivot here: this feeds BB's Display editor, which
                                // has no pivot field. The GUI pivot is export-only.)
                            },
                            ground: {
                                rotation:    [v('dGroundRX'), v('dGroundRY'), v('dGroundRZ')],
                                translation: [v('dGroundTX'), v('dGroundTY'), v('dGroundTZ')],
                                scale:       [sv('dGroundSX'), sv('dGroundSY'), sv('dGroundSZ')],
                            },
                            fixed: {
                                rotation:    [v('dFixedRX'), v('dFixedRY'), v('dFixedRZ')],
                                translation: [v('dFixedTX'), v('dFixedTY'), v('dFixedTZ')],
                                scale:       [sv('dFixedSX'), sv('dFixedSY'), sv('dFixedSZ')],
                            },
                            on_shelf: {
                                rotation:    [v('dShelfRX'), v('dShelfRY'), v('dShelfRZ')],
                                translation: [v('dShelfTX'), v('dShelfTY'), v('dShelfTZ')],
                                scale:       [sv('dShelfSX'), sv('dShelfSY'), sv('dShelfSZ')],
                            },
                        };
                    },
                    // Issue #10 two-way sync: pull BB's live display values (including
                    // edits made in BB's real Display editor) back into the dialog d*
                    // fields, so they show in the dialog AND reach the export. Called on
                    // open only after the user used the editor (one-shot flag), so it
                    // never pulls BB's inferred defaults on a normal open.
                    _loadFromDisplaySettings() {
                        if (typeof Project === 'undefined' || !Project || !Project.display_settings) return;
                        const PFX = {
                            thirdperson_righthand: 'dThird', thirdperson_lefthand: 'dLeft',
                            firstperson_righthand: 'dFpr',   firstperson_lefthand: 'dFpl',
                            head: 'dHead', gui: 'dGui', ground: 'dGround', fixed: 'dFixed', on_shelf: 'dShelf',
                        };
                        const ds = Project.display_settings;
                        for (const key in PFX) {
                            const slot = ds[key];
                            if (!slot) continue;
                            const p = PFX[key], r = slot.rotation, tr = slot.translation, s = slot.scale;
                            if (r && r.length === 3) { this[p+'RX'] = +r[0]||0; this[p+'RY'] = +r[1]||0; this[p+'RZ'] = +r[2]||0; }
                            if (tr && tr.length === 3) { this[p+'TX'] = +tr[0]||0; this[p+'TY'] = +tr[1]||0; this[p+'TZ'] = +tr[2]||0; }
                            // A 0 scale set in BB's editor is deliberate (hidden item) — keep it.
                            if (s && s.length === 3) {
                                const sn = (x) => Number.isFinite(+x) ? +x : 1;
                                this[p+'SX'] = sn(s[0]); this[p+'SY'] = sn(s[1]); this[p+'SZ'] = sn(s[2]);
                            }
                        }
                    },
                    // Issue #10: replaces the old in-dialog 3D preview. Writes the
                    // dialog's current per-slot transforms into the object BB's
                    // Display editor reads (Project.display_settings[slot], the
                    // DisplaySlot instances BB renders + lets you drag), enters BB's
                    // real Display mode on the active tab's slot, then closes this
                    // dialog so the editor is visible. Every BB touchpoint is guarded
                    // so a version/API mismatch degrades to a quick message, never a
                    // crash. NOTE: this is a one-way hand-off — edits the user makes
                    // inside BB's editor are not read back into the dialog; the dialog
                    // stays the source of truth for export.
                    openInDisplayEditor() {
                        if (typeof Project === 'undefined' || !Project) {
                            if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                                Blockbench.showQuickMessage(t('open_display_disabled'), 3000);
                            }
                            return;
                        }
                        const slotKey = this._slotKeyFor(this.displayTab);
                        // BB gates its Display mode behind Format.display_mode, which
                        // many obj3 source formats (Generic / free) leave off. Enable
                        // it for this session so the real editor can open; BB builds
                        // the display scene from the model geometry regardless.
                        try {
                            if (typeof Format !== 'undefined' && Format && !Format.display_mode) {
                                Format.display_mode = true;
                            }
                        } catch (e) {}
                        try {
                            // 1) Push dialog transforms into the display object BB reads.
                            if (typeof Project !== 'undefined' && Project) {
                                const settings = Project.display_settings || (Project.display_settings = {});
                                const transforms = this._dialogSlotTransforms();
                                for (const key in transforms) {
                                    const tr = transforms[key];
                                    let slot = settings[key];
                                    // Reuse the existing DisplaySlot if present (keeps BB's
                                    // class instance), else fall back to a plain object;
                                    // BB reads .rotation/.translation/.scale either way.
                                    if (!slot) {
                                        slot = (typeof DisplaySlot !== 'undefined')
                                            ? new DisplaySlot() : {};
                                        settings[key] = slot;
                                    }
                                    slot.rotation    = tr.rotation.slice();
                                    slot.translation = tr.translation.slice();
                                    slot.scale       = tr.scale.slice();
                                }
                            }
                        } catch (e) { /* mapping failed — still try to open the editor */ }

                        let entered = false;
                        try {
                            // 2) Switch BB into its real Display mode, on the active slot.
                            if (typeof Modes !== 'undefined' && Modes.options && Modes.options.display
                                && typeof Modes.options.display.select === 'function') {
                                Modes.options.display.select();
                                entered = (typeof Mode === 'undefined' || !Mode.selected
                                    || Mode.selected.id === 'display');
                                if (entered && typeof DisplayMode !== 'undefined'
                                    && typeof DisplayMode.load === 'function') {
                                    try { DisplayMode.load(slotKey); } catch (e) {}
                                    // Re-apply our just-written base values (load() may
                                    // re-read the slot; updateDisplayBase pushes them).
                                    if (typeof DisplayMode.updateDisplayBase === 'function') {
                                        try { DisplayMode.updateDisplayBase(); } catch (e) {}
                                    }
                                }
                            }
                        } catch (e) { entered = false; }

                        if (!entered) {
                            if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                                Blockbench.showQuickMessage(t('open_display_disabled'), 3000);
                            }
                            return; // leave the dialog open so the user is not stranded
                        }

                        if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                            try { Blockbench.showQuickMessage(t('status_display_mode'), 3500); } catch (e) {}
                        }
                        // Flag a one-shot pull so the NEXT time this dialog opens it
                        // reads back whatever the user adjusts in BB's Display editor,
                        // so those edits reach the export (two-way sync).
                        try { pullDisplayForProject = (typeof Project !== 'undefined' && Project && Project.uuid) || null; } catch (e) {}
                        // 3) Close this dialog so the now-behind BB editor is visible.
                        this.closeDialog();
                    },
                    scrollToFirstError() {
                        // Triggered by clicking the error badge in the footer.
                        // Scrolls the first .oc-err element into view and focuses it.
                        this.$nextTick(() => {
                            const el = this.$el && this.$el.querySelector('.oc-err');
                            if (!el) return;
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            const focusable = el.matches('input,select,textarea') ? el
                                : el.querySelector('input,select,textarea');
                            if (focusable) focusable.focus({ preventScroll: true });
                        });
                    },

                    browseDatapackDir() {
                        const dir = Blockbench.pickDirectory({
                            title: t('lbl_datapack_dir'),
                            startpath: this.datapackOutputDir || undefined,
                        });
                        if (dir) this.datapackOutputDir = dir;
                    },
                    browseResourcePackDir() {
                        const dir = Blockbench.pickDirectory({
                            title: t('lbl_respack_dir'),
                            startpath: this.resourcePackDir || undefined,
                        });
                        if (dir) this.resourcePackDir = dir;
                    },
                    cycleCb(channel) {
                        // Click a channel button → step through direct→time→overlay→hurt.
                        // 'scale' is intentionally not offered in the UI cycle (kept in the
                        // shader's index mapping for backward compatibility, see cbArr).
                        if (this.colorBehaviorForcedByDatapack) return;
                        const ORDER = ['direct','time','overlay','hurt'];
                        const cur = this[channel];
                        const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
                        this[channel] = next;
                    },
                    applyColorPreset(name) {
                        if (this.colorBehaviorForcedByDatapack) return;
                        const PRESETS = {
                            tint:    ['direct','direct','direct'],
                            anim:    ['time','time','time'],
                            scale:   ['scale','scale','scale'],
                            overlay: ['overlay','overlay','overlay'],
                            hurt:    ['hurt','hurt','hurt'],
                        };
                        const v = PRESETS[name];
                        if (!v) return;
                        this.cbR = v[0]; this.cbG = v[1]; this.cbB = v[2];
                    },
                    cbLabel(value) {
                        return ({
                            direct: t('cb_direct'), time: t('cb_time'),
                            scale: t('cb_scale'), overlay: t('cb_overlay'), hurt: t('cb_hurt'),
                        })[value] || value;
                    },
                    browseFilesOutputDir(field) {
                        const dir = pickDirectory(t(field === 'modelOutputDir' ? 'lbl_model_dir' : 'lbl_texture_dir'), this[field]);
                        if (dir) this[field] = dir;
                    },
                    onAnimChange() {
                        const anim = Animation.all[this.animationIndex];
                        if (anim) {
                            this.animFps = anim.snapping || 20;
                            this.animEnd = anim.length;
                            this.datapackAnimId = (anim.name || 'anim')
                                .replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 12) || 'anim';
                        }
                    },
                    async doExport() {
                        const wantDatapack = !!this.generateDatapack && this.showDatapackOption;
                        const cbParts = wantDatapack
                            ? ['time', 'time', 'time']
                            : [this.cbR, this.cbG, this.cbB];
                        this.running = true;
                        this.statusKind = 'progress';
                        this.status  = t('status_building');
                        try {
                            const cfg = {
                                texIndex:        +this.selectedTex,
                                useAtlas:        !!this.useAtlas,
                                atlasTexIndices:  atlasTexIndicesFrom(this.atlasTexChecked),
                                texAnimEnabled:  !!this.texAnimEnabled,
                                texFrametime:    Math.max(1, Math.round(+this.texFrametime || 1)),
                                texFade:         !!this.texFade,
                                scale:           +this.scale,
                                offset:          [+this.offsetX, +this.offsetY, +this.offsetZ],
                                animationEnabled: this.hasAnims && this.animationEnabled,
                                animationIndex:  +this.animationIndex,
                                animFps:         +this.animFps,
                                animStart:       +this.animStart,
                                animEnd:         +this.animEnd,
                                duration:        wantDatapack ? 0 : this.durationTicksAuto,
                                easing:          +this.easing,
                                interpolation:   +this.interpolation,
                                colorbehavior:   cbParts,
                                autorotate:      +this.autorotate,
                                autoplay:        wantDatapack ? false : !!this.autoplay,
                                flipuv:          !!this.flipuv,
                                noshadow:        !!this.noshadow,
                                nopow:           !!this.nopow,
                                filterArmature:  !!this.filterArmature,
                                visibility:      7, // world(4) + hand(2) + gui(1) — always all
                                generateDatapack: wantDatapack,
                                exportCameras: wantDatapack && !!this.exportCameras,
                                datapackNamespace: this.datapackNamespace || 'objcubed',
                                datapackAnimId:  this.datapackAnimId || 'anim',
                                datapackTargetType: this.datapackTargetType,
                                datapackEquipSlot:  this.datapackEquipSlot,
                                datapackOutputDir:  this.datapackOutputDir,
                                resourcePackDir:    this.resourcePackDir,
                                outputMode: this.outputMode,
                                modelOutputDir: this.modelOutputDir,
                                textureOutputDir: this.textureOutputDir,
                                textureResource: this.textureResource,
                                selectedContexts: this.customContexts ? this.selectedContexts.slice() : undefined,
                                baseItem:           this.baseItem,
                                cmdName:            this.cmdName,
                                exportAsEquipment:  !!this.exportAsEquipment,
                                equipmentTarget:    this.equipmentTarget,
                                equipmentSlot:      this.equipmentSlot,
                                selectedPieces:     Array.isArray(this.selectedPieces) ? this.selectedPieces.slice() : [],
                                displaySlots: (() => {
                                    // Single source of truth: reuse the BB-editor transforms
                                    // (scale already `|| 1`, rot/trans `|| 0`) and add the
                                    // export-only GUI rotation pivot (BB units 0..16 → /16).
                                    const slots = this._dialogSlotTransforms();
                                    slots.gui.pivot = [
                                        (+this.dGuiPX || 0) / 16,
                                        (+this.dGuiPY || 0) / 16,
                                        (+this.dGuiPZ || 0) / 16,
                                    ];
                                    return slots;
                                })(),
                            };
                            await runExport(cfg, msg => { this.status = msg; });
                            this.statusKind = 'done';
                        } catch(err) {
                            if (err && err.message === '__cancelled__') {
                                this.statusKind = 'cancelled';
                                this.status = t('status_cancelled');
                                if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                                    Blockbench.showQuickMessage(t('status_cancelled'), 2500);
                                }
                            } else {
                                // Null-safe: a non-Error/falsy throw (e.g. `throw null`) would
                                // make `err.message` a secondary TypeError that masks the real
                                // failure. Coerce to a string for both the status and the toast.
                                const m = (err && err.message) || String(err);
                                this.statusKind = 'error';
                                this.status = t('export_failed') + m;
                                console.error('[obj3]', err);
                                if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                                    Blockbench.showQuickMessage(t('export_failed') + m, 4000);
                                }
                            }
                        } finally {
                            this.running = false;
                        }
                    },
                },
                template: `
<div class="oc-root" style="padding:16px 20px;line-height:1.6;overflow-x:hidden;">

  <!-- Header row: replay the guided tour (issue #4) -->
  <div class="oc-root-head">
    <button type="button" class="oc-tour-btn" @click="startTour" :title="t('tour_btn')">
      <i class="material-icons">help_outline</i><span>{{t('tour_btn')}}</span>
    </button>
  </div>

  <!-- ======== TEXTURE ======== -->
  <!-- oc-tour-texture: tour anchor (issue #4) — keep on the Texture card -->
  <div class="oc-section oc-tour-texture" style="padding:10px 12px;">
    <div class="oc-section-head">
      <i class="material-icons">image</i>
      <span>{{t('section_texture')}}</span>
      <span class="oc-help" tabindex="0" :aria-label="help('selectedTex')" :data-tip="help('selectedTex')">?</span>
    </div>
    <!-- Single texture: preview + select -->
    <div v-if="!multiTex" style="display:flex;align-items:center;gap:10px;padding:0 4px;">
      <img v-if="selectedTexThumb" :src="selectedTexThumb"
           style="width:48px;height:48px;image-rendering:pixelated;border-radius:4px;object-fit:contain;background:rgba(255,255,255,0.04);flex-shrink:0;"/>
      <select v-model="selectedTex" style="flex:1;padding:4px 6px;">
        <option v-for="tx in texOptions" :key="tx.value" :value="tx.value">{{tx.label}}</option>
      </select>
    </div>
    <!-- Multi-texture: atlas toggle + list -->
    <div v-else style="padding:0 4px;">
      <!-- oc-tour-atlas: tour anchor (issue #4) — on the combine-into-atlas toggle -->
      <label class="oc-tour-atlas" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;">
        <input type="checkbox" v-model="useAtlas"/>
        <span>{{t('atlas_combine')}}</span>
        <span class="oc-help" tabindex="0" :aria-label="help('useAtlas')" :data-tip="help('useAtlas')">?</span>
      </label>
      <div v-if="!useAtlas" style="display:flex;align-items:center;gap:10px;">
        <img v-if="selectedTexThumb" :src="selectedTexThumb"
             style="width:48px;height:48px;image-rendering:pixelated;border-radius:4px;object-fit:contain;background:rgba(255,255,255,0.04);flex-shrink:0;"/>
        <select v-model="selectedTex" style="flex:1;padding:4px 6px;">
          <option v-for="tx in texOptions" :key="tx.value" :value="tx.value">{{tx.label}}</option>
        </select>
      </div>
      <div v-else :class="hasErr('atlas') ? 'oc-err' : ''" style="padding:6px 8px;border-radius:4px;background:rgba(255,255,255,0.02);display:flex;flex-direction:column;gap:5px;">
        <label v-for="(tx, i) in texOptions" :key="tx.value" style="display:flex;align-items:center;gap:8px;line-height:1.4;cursor:pointer;">
          <input type="checkbox" :checked="atlasTexChecked[i]" @change="setAtlasChecked(i, $event.target.checked)"/>
          <img v-if="tx.thumb" :src="tx.thumb" class="oc-tex-thumb"/>
          <span>{{tx.label}}</span>
        </label>
      </div>
    </div>
  </div>

  <!-- ======== DISPLAY (per-slot tabs with rotation / translation / scale) ======== -->
  <div class="oc-section" style="padding:10px 12px;">
    <div class="oc-section-head" style="margin-bottom:8px;">
      <i class="material-icons">view_in_ar</i>
      <span>{{t('section_display')}}</span><span class="oc-help" tabindex="0" :aria-label="help('display')" :data-tip="help('display')">?</span>
    </div>

    <div class="oc-display-tabs">
      <!-- R/L pairs share an icon; the LEFT one is CSS-mirrored (scaleX(-1)),
           the same visual language Blockbench's Display editor uses for sides. -->
      <button :class="['oc-display-tab', {active: displayTab==='third'}]"  @click="displayTab='third'" :title="t('tab_third')"><i class="material-icons">back_hand</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='left'}]"   @click="displayTab='left'" :title="t('tab_left')"><i class="material-icons" style="transform:scaleX(-1);">back_hand</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='fpr'}]"    @click="displayTab='fpr'" :title="t('tab_fpr')"><i class="material-icons">front_hand</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='fpl'}]"    @click="displayTab='fpl'" :title="t('tab_fpl')"><i class="material-icons" style="transform:scaleX(-1);">front_hand</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='head'}]"   @click="displayTab='head'" :title="t('tab_head')"><i class="material-icons">face</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='gui'}]"    @click="displayTab='gui'" :title="t('tab_gui')"><i class="material-icons">grid_view</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='ground'}]" @click="displayTab='ground'" :title="t('tab_ground')"><i class="material-icons">download</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='fixed'}]"  @click="displayTab='fixed'" :title="t('tab_fixed')"><i class="material-icons">crop_square</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='shelf'}]"  @click="displayTab='shelf'" :title="t('tab_shelf')"><i class="material-icons">shelves</i></button>
    </div>

    <!-- Issue #10: BB's real renderer cannot live in a modal dialog (it renders
         blank), so instead of an in-dialog 3D preview we drive Blockbench's own
         native Display editor. The button writes the dialog's current per-slot
         transforms into BB and opens its Display editor on the active slot. -->
    <!-- oc-tour-preview: tour anchor (issue #4) — kept on this cell -->
    <div class="oc-display-preview oc-tour-preview">
      <button type="button" class="oc-open-display-btn"
              :disabled="!displayModeAvailable"
              @click="openInDisplayEditor"
              :title="help('displayPreview')">
        <i class="material-icons">view_in_ar</i>
        <span>{{t('open_display_editor')}}</span>
      </button>
      <span class="oc-help" tabindex="0" :aria-label="help('displayPreview')" :data-tip="help('displayPreview')">?</span>
      <div v-if="!displayModeAvailable" class="oc-display-preview-note">{{t('open_display_disabled')}}</div>
    </div>

    <!-- 3-е лицо (thirdperson) -->
    <!-- oc-tour-thirdrow: tour anchor (issue #4) — on the WHOLE 3rd-person panel
         so the transform step spotlights all three rows (rotation/translation/scale) -->
    <div v-show="displayTab==='third'" class="oc-tour-thirdrow">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dThirdRX',1)"><input v-model.number="dThirdRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dThirdRY',1)"><input v-model.number="dThirdRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dThirdRZ',1)"><input v-model.number="dThirdRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dThirdTX',0.5)"><input v-model.number="dThirdTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dThirdTY',0.5)"><input v-model.number="dThirdTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dThirdTZ',0.5)"><input v-model.number="dThirdTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dThirdSX',0.05)"><input v-model.number="dThirdSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dThirdSY',0.05)"><input v-model.number="dThirdSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dThirdSZ',0.05)"><input v-model.number="dThirdSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- 3-е лицо ЛЕВАЯ рука (thirdperson_lefthand) — own tab, always separate.
         Old projects that mirrored the right hand are migrated in data(): the
         right-hand values are copied over once (useSeparateLefthand flag). -->
    <div v-show="displayTab==='left'">
      <div>
        <div class="oc-xyz-row">
          <span>{{t('lbl_rotation')}}</span>
          <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dLeftRX',1)"><input v-model.number="dLeftRX" type="number" step="1"/></div>
          <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dLeftRY',1)"><input v-model.number="dLeftRY" type="number" step="1"/></div>
          <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dLeftRZ',1)"><input v-model.number="dLeftRZ" type="number" step="1"/></div>
        </div>
        <div class="oc-xyz-row">
          <span>{{t('lbl_translation')}}</span>
          <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dLeftTX',0.5)"><input v-model.number="dLeftTX" type="number" step="0.5"/></div>
          <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dLeftTY',0.5)"><input v-model.number="dLeftTY" type="number" step="0.5"/></div>
          <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dLeftTZ',0.5)"><input v-model.number="dLeftTZ" type="number" step="0.5"/></div>
        </div>
        <div class="oc-xyz-row">
          <span>{{t('lbl_display_scale')}}</span>
          <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dLeftSX',0.05)"><input v-model.number="dLeftSX" type="number" step="0.05"/></div>
          <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dLeftSY',0.05)"><input v-model.number="dLeftSY" type="number" step="0.05"/></div>
          <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dLeftSZ',0.05)"><input v-model.number="dLeftSZ" type="number" step="0.05"/></div>
        </div>
      </div>
    </div>

    <!-- 1-е лицо правое (firstperson_righthand) -->
    <div v-show="displayTab==='fpr'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFprRX',1)"><input v-model.number="dFprRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFprRY',1)"><input v-model.number="dFprRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFprRZ',1)"><input v-model.number="dFprRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFprTX',0.5)"><input v-model.number="dFprTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFprTY',0.5)"><input v-model.number="dFprTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFprTZ',0.5)"><input v-model.number="dFprTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFprSX',0.05)"><input v-model.number="dFprSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFprSY',0.05)"><input v-model.number="dFprSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFprSZ',0.05)"><input v-model.number="dFprSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- 1-е лицо левое (firstperson_lefthand) -->
    <div v-show="displayTab==='fpl'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFplRX',1)"><input v-model.number="dFplRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFplRY',1)"><input v-model.number="dFplRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFplRZ',1)"><input v-model.number="dFplRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFplTX',0.5)"><input v-model.number="dFplTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFplTY',0.5)"><input v-model.number="dFplTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFplTZ',0.5)"><input v-model.number="dFplTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFplSX',0.05)"><input v-model.number="dFplSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFplSY',0.05)"><input v-model.number="dFplSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFplSZ',0.05)"><input v-model.number="dFplSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- Голова -->
    <div v-show="displayTab==='head'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dHeadRX',1)"><input v-model.number="dHeadRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dHeadRY',1)"><input v-model.number="dHeadRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dHeadRZ',1)"><input v-model.number="dHeadRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dHeadTX',0.5)"><input v-model.number="dHeadTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dHeadTY',0.5)"><input v-model.number="dHeadTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dHeadTZ',0.5)"><input v-model.number="dHeadTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dHeadSX',0.05)"><input v-model.number="dHeadSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dHeadSY',0.05)"><input v-model.number="dHeadSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dHeadSZ',0.05)"><input v-model.number="dHeadSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- Инвентарь (gui) -->
    <div v-show="displayTab==='gui'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGuiRX',1)"><input v-model.number="dGuiRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGuiRY',1)"><input v-model.number="dGuiRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGuiRZ',1)"><input v-model.number="dGuiRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGuiTX',0.5)"><input v-model.number="dGuiTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGuiTY',0.5)"><input v-model.number="dGuiTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGuiTZ',0.5)"><input v-model.number="dGuiTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGuiSX',0.05)"><input v-model.number="dGuiSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGuiSY',0.05)"><input v-model.number="dGuiSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGuiSZ',0.05)"><input v-model.number="dGuiSZ" type="number" step="0.05"/></div>
      </div>
      <!-- (GUI pivot inputs UI-retired: the default — the block centre, vanilla's
           display pivot — is correct for everyone now; a stray value here only
           desynced the icon from vanilla. dGuiP* stay persisted/encoded so an
           old project's custom pivot keeps working.) -->
    </div>

    <!-- Земля -->
    <div v-show="displayTab==='ground'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGroundRX',1)"><input v-model.number="dGroundRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGroundRY',1)"><input v-model.number="dGroundRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGroundRZ',1)"><input v-model.number="dGroundRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGroundTX',0.5)"><input v-model.number="dGroundTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGroundTY',0.5)"><input v-model.number="dGroundTY" type="number" step="0.5" :data-tip="t('ground_y_tip')"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGroundTZ',0.5)"><input v-model.number="dGroundTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGroundSX',0.05)"><input v-model.number="dGroundSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGroundSY',0.05)"><input v-model.number="dGroundSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGroundSZ',0.05)"><input v-model.number="dGroundSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- Рамка (fixed) -->
    <div v-show="displayTab==='fixed'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFixedRX',1)"><input v-model.number="dFixedRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFixedRY',1)"><input v-model.number="dFixedRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFixedRZ',1)"><input v-model.number="dFixedRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFixedTX',0.5)"><input v-model.number="dFixedTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFixedTY',0.5)"><input v-model.number="dFixedTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFixedTZ',0.5)"><input v-model.number="dFixedTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFixedSX',0.05)"><input v-model.number="dFixedSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFixedSY',0.05)"><input v-model.number="dFixedSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFixedSZ',0.05)"><input v-model.number="dFixedSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- Полка (on_shelf) -->
    <div v-show="displayTab==='shelf'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dShelfRX',1)"><input v-model.number="dShelfRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dShelfRY',1)"><input v-model.number="dShelfRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dShelfRZ',1)"><input v-model.number="dShelfRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dShelfTX',0.5)"><input v-model.number="dShelfTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dShelfTY',0.5)"><input v-model.number="dShelfTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dShelfTZ',0.5)"><input v-model.number="dShelfTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dShelfSX',0.05)"><input v-model.number="dShelfSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dShelfSY',0.05)"><input v-model.number="dShelfSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dShelfSZ',0.05)"><input v-model.number="dShelfSZ" type="number" step="0.05"/></div>
      </div>
    </div>

  </div>

  <!-- ======== BEHAVIOR (animation + color + advanced merged) ======== -->
  <div class="oc-section" style="padding:10px 12px;">
    <div class="oc-section-head" style="margin-bottom:8px;">
      <i class="material-icons">tune</i>
      <span>{{t('section_behavior')}}</span>
    </div>

    <!-- Animation sub-section -->
    <!-- oc-tour-animation: tour anchor (issue #4) — on BOTH branches so the
         visible one is always found regardless of whether the project has anims -->
    <div v-if="hasAnims" class="oc-tour-animation" style="display:flex;align-items:center;gap:8px;">
      <label style="font-weight:600;color:#ddd;display:inline-flex;align-items:center;gap:6px;flex:1;">
        <input v-model="animationEnabled" type="checkbox"/>
        <span>{{t('section_animation')}}</span><span class="oc-help" tabindex="0" :aria-label="help('animationEnabled')" :data-tip="help('animationEnabled')">?</span>
      </label>
    </div>
    <div v-else class="oc-tour-animation" style="display:flex;align-items:center;gap:8px;color:#777;font-size:calc(12px * var(--oc-scale));">
      <i class="material-icons" style="font-size:calc(18px * var(--oc-scale));color:#555;">play_disabled</i>
      <span>{{t('no_animations')}}</span>
    </div>

    <div v-if="hasAnims && animationEnabled" style="margin-top:10px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:grid;grid-template-columns:1fr 80px;gap:8px;">
        <!-- oc-tour-animselect: tour anchor (issue #4) — on the animation clip select -->
        <label class="oc-tour-animselect" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_animation')}}<span class="oc-help" tabindex="0" :aria-label="help('animationIndex')" :data-tip="help('animationIndex')">?</span></span>
          <select v-model="animationIndex" @change="onAnimChange" style="padding:4px 6px;">
            <option v-for="a in animOptions" :key="a.value" :value="a.value">{{a.label}}</option>
          </select>
        </label>
        <!-- oc-tour-fps: tour anchor (issue #4) — on the FPS field -->
        <label class="oc-tour-fps" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;">
          <span>FPS<span class="oc-help" tabindex="0" :aria-label="help('animFps')" :data-tip="help('animFps')">?</span></span>
          <input v-model.number="animFps" type="number" min="1" max="60" :class="hasErr('animFps') ? 'oc-err' : ''"/>
          <span v-if="hasErr('animFps')" class="oc-err-msg">{{fieldErrorMap.animFps}}</span>
        </label>
      </div>
      <!-- oc-tour-range: tour anchor (issue #4) — on the Start/End range row -->
      <div class="oc-tour-range" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_start')}}<span class="oc-help" tabindex="0" :aria-label="help('animRange')" :data-tip="help('animRange')">?</span></span>
          <input v-model.number="animStart" type="number" step="0.05"/>
        </label>
        <label style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_end')}}</span>
          <input v-model.number="animEnd" type="number" step="0.05" :class="hasErr('animEnd') ? 'oc-err' : ''"/>
          <span v-if="hasErr('animEnd')" class="oc-err-msg">{{fieldErrorMap.animEnd}}</span>
        </label>
      </div>
      <div v-if="frameCountPreview" class="oc-frame-chip">
        <i class="material-icons">movie</i>
        <span>{{frameCountPreview}} · {{t('lbl_duration')}} {{durationTicksAuto}} {{tPlural(durationTicksAuto,'ticks')}}</span>
      </div>
      <!-- oc-tour-autoplay: tour anchor (issue #4) — keep on the autoplay row -->
      <label class="oc-tour-autoplay" style="display:inline-flex;align-items:center;gap:6px;font-size:calc(12px * var(--oc-scale));">
        <input v-model="autoplay" type="checkbox" :disabled="generateDatapack"/>
        <span>{{t('lbl_autoplay')}}</span><span class="oc-help" tabindex="0" :aria-label="help('autoplay')" :data-tip="help('autoplay')">?</span>
      </label>

    </div>

    <!-- Animated textures (issue #9): only when a frame-strip texture is present.
         Sits between the geometry animation and the datapack block — all three
         are playback controls, and texAnim is independent of the geometry anim. -->
    <div v-if="texFrameCount > 1" class="oc-tour-texanim" style="margin-top:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="font-weight:600;color:#ddd;display:inline-flex;align-items:center;gap:6px;flex:1;">
          <input type="checkbox" v-model="texAnimEnabled"/>
          <span>{{t('tex_anim_enable')}}</span>
          <span class="oc-help" tabindex="0" :aria-label="help('texAnim')" :data-tip="help('texAnim')">?</span>
        </label>
      </div>
      <div v-if="texAnimEnabled" style="margin-top:10px;display:flex;flex-direction:column;gap:10px;">
        <label style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;max-width:140px;">
          <span>{{t('tex_frametime')}}<span class="oc-help" tabindex="0" :aria-label="help('texFrametime')" :data-tip="help('texFrametime')">?</span></span>
          <input v-model.number="texFrametime" type="number" min="1" step="1" @change="clampTexFrametime"/>
        </label>
        <div class="oc-frame-chip">
          <i class="material-icons">movie</i>
          <span>{{texFrameCount}} {{tPlural(texFrameCount,'frames')}} · {{texFrametime}} {{tPlural(texFrametime,'ticks')}} {{t('tex_chip_each')}}</span>
        </div>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:calc(12px * var(--oc-scale));">
          <input type="checkbox" v-model="texFade"/>
          <span>{{t('tex_fade')}}</span>
          <span class="oc-help" tabindex="0" :aria-label="help('texFade')" :data-tip="help('texFade')">?</span>
        </label>
      </div>
    </div>

    <!-- Playback shaping: easing (geometry frame blending) + autorotate.
         Ungated: autorotate matters for STATIC exports too (item frames). -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
      <!-- oc-tour-easing: tour anchor (issue #4) — on the easing select only -->
      <label class="oc-tour-easing" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
        <span>{{t('lbl_easing')}}<span class="oc-help" tabindex="0" :aria-label="help('easing')" :data-tip="help('easing')">?</span></span>
        <select v-model="easing" style="padding:4px 6px;">
          <option :value="0">{{t('opt_none')}}</option>
          <option :value="1">{{t('opt_linear')}}</option>
          <option :value="2">{{t('opt_cubic')}}</option>
          <option :value="3">{{t('opt_bezier')}}</option>
          <option :value="4">{{t('opt_easein')}}</option>
          <option :value="5">{{t('opt_easeout')}}</option>
        </select>
      </label>
      <!-- oc-tour-autorotate: tour anchor (issue #4) — on the autorotate select -->
      <label class="oc-tour-autorotate" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
        <span>{{t('lbl_autorotate')}}<span class="oc-help" tabindex="0" :aria-label="help('autorotate')" :data-tip="help('autorotate')">?</span></span>
        <select v-model="autorotate" style="padding:4px 6px;">
          <option :value="0">{{t('opt_off')}}</option>
          <option :value="1">{{t('opt_horizontal')}}</option>
          <option :value="2">{{t('opt_vertical')}}</option>
          <option :value="3">{{t('opt_both')}}</option>
        </select>
      </label>
    </div>

      <!-- Datapack sub-block (self-gated: showDatapackOption = hasAnims && animationEnabled) -->
      <!-- oc-tour-datapack: tour anchor (issue #4) — keep on the datapack block -->
      <div v-if="showDatapackOption" class="oc-tour-datapack" style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.1);">
        <label style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:#ddd;">
          <input v-model="generateDatapack" type="checkbox"/>
          <i class="material-icons" style="font-size:calc(16px * var(--oc-scale));color:#5a8cc0;">terminal</i>
          <span>{{t('lbl_datapack')}}</span>
          <span class="oc-help" tabindex="0" :aria-label="help('generateDatapack')" :data-tip="help('generateDatapack')">?</span>
        </label>

        <div v-if="generateDatapack" style="margin-top:8px;font-size:calc(12px * var(--oc-scale));display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;gap:8px;">
            <input v-model="exportCameras" type="checkbox"/>
            <span>{{t('lbl_export_cameras')}}</span>
            <span class="oc-help" tabindex="0" :aria-label="help('exportCameras')" :data-tip="help('exportCameras')">?</span>
          </label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <!-- oc-tour-datapackid: tour anchor (issue #4) — wraps anim id + namespace
                 so the step spotlights both fields, not just one -->
            <div class="oc-tour-datapackid" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <label style="color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <span>{{t('lbl_anim_id')}}<span class="oc-help" tabindex="0" :aria-label="help('datapackAnimId')" :data-tip="help('datapackAnimId')">?</span></span>
                <input v-model="datapackAnimId" placeholder="anim" maxlength="12" :class="hasErr('datapackAnimId') ? 'oc-err' : ''"/>
                <span v-if="hasErr('datapackAnimId')" class="oc-err-msg">{{fieldErrorMap.datapackAnimId}}</span>
              </label>
              <label style="color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <span>{{t('lbl_namespace')}}<span class="oc-help" tabindex="0" :aria-label="help('datapackNamespace')" :data-tip="help('datapackNamespace')">?</span></span>
                <input v-model="datapackNamespace" placeholder="objcubed" :class="hasErr('datapackNamespace') ? 'oc-err' : ''"/>
                <span v-if="hasErr('datapackNamespace')" class="oc-err-msg">{{fieldErrorMap.datapackNamespace}}</span>
              </label>
            </div>
            <!-- oc-tour-datapacktarget: tour anchor (issue #4) — wraps target + slot -->
            <div v-if="isHorseEquipment" class="oc-tour-datapacktarget" style="grid-column:1/-1;color:#aaa;">
              {{t('lbl_target')}}: {{animalDatapackTarget}}
              <span class="oc-help" tabindex="0" :aria-label="help('animalDatapack')" :data-tip="help('animalDatapack')">?</span>
            </div>
            <div v-else class="oc-tour-datapacktarget" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <label style="color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <span>{{t('lbl_target')}}<span class="oc-help" tabindex="0" :aria-label="help('datapackTargetType')" :data-tip="help('datapackTargetType')">?</span></span>
                <select v-model="datapackTargetType" style="padding:4px 6px;">
                  <option value="equipment">{{t('opt_equipment')}}</option>
                  <option value="item_display">{{t('opt_item_display')}}</option>
                  <option value="player">{{t('opt_player')}}</option>
                </select>
              </label>
              <label v-if="datapackTargetType !== 'item_display'" style="color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <span>{{t('lbl_slot')}}<span class="oc-help" tabindex="0" :aria-label="help('datapackEquipSlot')" :data-tip="help('datapackEquipSlot')">?</span></span>
                <select v-model="datapackEquipSlot" style="padding:4px 6px;">
                  <option value="mainhand">{{t('opt_mainhand')}}</option>
                  <option value="offhand">{{t('opt_offhand')}}</option>
                  <option value="head">{{t('opt_head')}}</option>
                  <option value="chest">{{t('opt_chest')}}</option>
                  <option value="legs">{{t('opt_legs')}}</option>
                  <option value="feet">{{t('opt_feet')}}</option>
                </select>
              </label>
            </div>
            <label style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
              <span>{{t('lbl_datapack_dir')}}<span class="oc-help" tabindex="0" :aria-label="help('datapackOutputDir')" :data-tip="help('datapackOutputDir')">?</span></span>
              <div style="display:flex;gap:6px;">
                <input v-model="datapackOutputDir" style="flex:1;min-width:0;" :placeholder="t('placeholder_near_png')"/>
                <button class="oc-btn oc-icon-btn" style="width:24px;height:24px;min-width:24px;min-height:24px;max-width:24px;max-height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;overflow:hidden;" @click="browseDatapackDir" :data-tip="t('tip_browse_folder')"><i class="material-icons">folder_open</i></button>
              </div>
            </label>
          </div>
          <div style="color:#aaa;">
            {{t('lbl_datapack_commands')}} <span class="oc-help" tabindex="0" :aria-label="help('datapackCommands')" :data-tip="help('datapackCommands')">?</span>
          </div>
        </div>
      </div>

    <!-- Separator -->
    <div style="border-top:1px solid rgba(255,255,255,0.06);margin:12px 0;"></div>

    <!-- Output sub-section -->
    <div class="oc-output-options">
      <label class="oc-output-field">
        <span>{{t('lbl_output_mode')}}<span class="oc-help" tabindex="0" :aria-label="help('output_mode')" :data-tip="help('output_mode')">?</span></span>
        <select v-model="outputMode"><option value="pack">{{t('output_pack')}}</option><option value="files">{{t('output_files')}}</option></select>
      </label>
      <label class="oc-output-field">
        <span>{{t('lbl_contexts')}}<span class="oc-help" tabindex="0" :aria-label="help('contexts')" :data-tip="help('contexts')">?</span></span>
        <select v-model="customContexts"><option :value="false">{{t('contexts_auto')}}</option><option :value="true">{{t('contexts_selected')}}</option></select>
      </label>
      <div v-if="customContexts" class="oc-context-options">
        <label><input type="checkbox" checked disabled/> default</label>
        <label v-for="context in contextOptions" :key="context.id"><input type="checkbox" v-model="selectedContexts" :value="context.id"/> {{context.label}}</label>
      </div>
      <template v-if="outputMode === 'files'">
        <label class="oc-output-field">
          <span>{{t('lbl_model_dir')}}</span>
          <div class="oc-output-path"><input v-model="modelOutputDir"/>
            <button type="button" class="oc-btn oc-output-browse" @click="browseFilesOutputDir('modelOutputDir')" :aria-label="t('lbl_model_dir')" :data-tip="t('tip_browse_folder')"><i class="material-icons">folder_open</i></button>
          </div>
        </label>
        <label class="oc-output-field">
          <span>{{t('lbl_texture_dir')}}</span>
          <div class="oc-output-path"><input v-model="textureOutputDir"/>
            <button type="button" class="oc-btn oc-output-browse" @click="browseFilesOutputDir('textureOutputDir')" :aria-label="t('lbl_texture_dir')" :data-tip="t('tip_browse_folder')"><i class="material-icons">folder_open</i></button>
          </div>
        </label>
        <label class="oc-output-field">
          <span>{{t('lbl_texture_resource')}}<span class="oc-help" tabindex="0" :aria-label="help('texture_resource')" :data-tip="help('texture_resource')">?</span></span>
          <input v-model="textureResource" placeholder="objcubed:item/my_model"/>
        </label>
      </template>
    </div>
    <div style="margin-bottom:10px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:calc(12px * var(--oc-scale));">
        <!-- oc-tour-respack: tour anchor (issue #4) — keep on the resource-pack dir row -->
        <label v-if="outputMode !== 'files'" class="oc-tour-respack" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_respack_dir')}}<span class="oc-help" tabindex="0" :aria-label="help('respack_dir')" :data-tip="help('respack_dir')">?</span></span>
          <div style="display:flex;gap:6px;">
            <input v-model="resourcePackDir" style="flex:1;min-width:0;" placeholder="…/resourcepacks/MyPack"/>
            <button class="oc-btn oc-icon-btn" style="width:24px;height:24px;min-width:24px;min-height:24px;max-width:24px;max-height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;overflow:hidden;" @click="browseResourcePackDir" :data-tip="t('tip_browse_folder')"><i class="material-icons">folder_open</i></button>
          </div>
        </label>
        <!-- oc-tour-baseitem: tour anchor (issue #4) — on the base item field.
             Combobox: free typing always works; when the item registry loaded
             (fetched once from the mcasset mirror, cached in localStorage) a
             filtered dropdown with item icons appears. Offline = plain input. -->
        <label v-if="outputMode !== 'files' && !isHorseEquipment" class="oc-tour-baseitem" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;position:relative;">
          <span>{{t('lbl_base_item')}}<span class="oc-help" tabindex="0" :aria-label="help('base_item')" :data-tip="help('base_item')">?</span></span>
          <div style="display:flex;gap:6px;align-items:center;">
            <img v-if="baseItemKnown" :src="itemIconUrl(baseItem)" class="oc-item-icon"
                 @error="$event.target.style.visibility='hidden'"/>
            <input v-model="baseItem" placeholder="iron_ingot" style="flex:1;min-width:0;"
                   @focus="itemPickerOpen = true" @input="itemPickerOpen = true"
                   @blur="closeItemPicker" @keydown.esc="itemPickerOpen = false"/>
          </div>
          <div v-if="itemPickerOpen && filteredItems.length" class="oc-item-list">
            <div v-for="id in filteredItems" :key="id" class="oc-item-row" @mousedown.prevent="pickBaseItem(id)">
              <img :src="itemIconUrl(id)" class="oc-item-icon" loading="lazy"
                   @error="$event.target.style.visibility='hidden'"/>
              <span>{{id}}</span>
            </div>
          </div>
        </label>
        <!-- oc-tour-cmdname: tour anchor (issue #4) — on the custom_model_data name field -->
        <label class="oc-tour-cmdname" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_cmd_name')}}<span class="oc-help" tabindex="0" :aria-label="help('cmd_name')" :data-tip="help('cmd_name')">?</span></span>
          <input v-model="cmdName" placeholder="my_model"/>
        </label>

        <!-- Equipment (armor) export — Approach C -->
        <!-- oc-tour-equipment: tour anchor (issue #4) — keep on the equipment toggle -->
        <label class="oc-tour-equipment" style="grid-column:1/-1;display:inline-flex;align-items:center;gap:6px;font-size:calc(12px * var(--oc-scale));">
          <input v-model="exportAsEquipment" type="checkbox" :disabled="outputMode === 'files'"/>
          <span>{{t('lbl_export_equipment')}}</span>
          <span class="oc-help" tabindex="0" :aria-label="help('equipment')" :data-tip="help('equipment')">?</span>
        </label>
        <!-- oc-tour-equipslot: tour anchor — the WHOLE-SET piece checkboxes.
             (The legacy per-body-part slot selector is UI-retired: the piece
             path supersedes it. The legacy export code stays for old projects
             whose persisted selectedPieces is empty.) -->
        <label v-if="exportAsEquipment" class="oc-tour-equipslot" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;">
          <span>{{t('lbl_equipment_target')}}</span>
          <select v-model="equipmentTarget" style="padding:4px 6px;">
            <option value="humanoid">{{t('opt_humanoid')}}</option>
            <option v-for="target in animalTargets" :key="target.id" :value="target.id">{{target.label}}</option>
          </select>
        </label>
        <div v-if="isHorseEquipment" style="grid-column:1/-1;color:#aaa;font-size:calc(12px * var(--oc-scale));line-height:1.5;">
          {{t('animal_supported_parts')}}: {{animalPartLabels}}
          <span class="oc-help" tabindex="0" :aria-label="animalBindingsHelp" :data-tip="animalBindingsHelp">?</span>
        </div>
        <label v-if="exportAsEquipment && !isHorseEquipment" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_equip_pieces')}}<span class="oc-help" tabindex="0" :aria-label="help('equip_pieces')" :data-tip="help('equip_pieces')">?</span></span>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <label style="display:flex;gap:4px;align-items:center;color:#ccc;"><input type="checkbox" v-model="selectedPieces" value="helmet"/>{{t('opt_piece_helmet')}}</label>
            <label style="display:flex;gap:4px;align-items:center;color:#ccc;"><input type="checkbox" v-model="selectedPieces" value="chestplate"/>{{t('opt_piece_chestplate')}}</label>
            <label style="display:flex;gap:4px;align-items:center;color:#ccc;"><input type="checkbox" v-model="selectedPieces" value="leggings"/>{{t('opt_piece_leggings')}}</label>
            <label style="display:flex;gap:4px;align-items:center;color:#ccc;"><input type="checkbox" v-model="selectedPieces" value="boots"/>{{t('opt_piece_boots')}}</label>
          </div>
        </label>
      </div>
    </div>

    <!-- Separator -->
    <div style="border-top:1px solid rgba(255,255,255,0.06);margin:12px 0;"></div>

    <!-- Color & Tinting sub-section -->
    <!-- oc-tour-color: tour anchor (issue #4) — keep on the Color & Tinting block -->
    <div class="oc-tour-color" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600;color:#ddd;font-size:calc(12px * var(--oc-scale));">
        <span>{{t('section_color')}}</span>
        <span class="oc-help" tabindex="0" :aria-label="help('cb_general')" :data-tip="help('cb_general')">?</span>
      </div>
      <div v-if="!colorBehaviorForcedByDatapack">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <button v-for="cn in [{k:'cbR',col:'#d44'},{k:'cbG',col:'#4d4'},{k:'cbB',col:'#48f'}]" :key="cn.k"
                  class="oc-cb-btn"
                  @click="cycleCb(cn.k)"
                  :style="{border:'1px solid '+cn.col}">
            <span class="oc-cb-letter" :style="{color:cn.col}">{{cn.k.slice(-1)}}</span>
            <span class="oc-cb-value">{{cbLabel($data[cn.k])}}</span>
          </button>
        </div>
      </div>
      <div v-else style="color:#777;font-size:calc(12px * var(--oc-scale));">
        {{t('color_datapack_note')}}. <span class="oc-help" tabindex="0" :aria-label="help('generateDatapack')" :data-tip="help('generateDatapack')">?</span>
      </div>
      <div v-if="exportAsEquipment" style="margin-top:8px;color:#aaa;font-size:calc(12px * var(--oc-scale));">
        {{t('color_equipment_note')}} <span class="oc-help" tabindex="0" :aria-label="help('cb_general')" :data-tip="help('cb_general')">?</span>
      </div>
    </div>

    <!-- Separator -->
    <div style="border-top:1px solid rgba(255,255,255,0.06);margin:12px 0;"></div>

    <!-- Advanced sub-section -->
    <div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600;color:#ddd;font-size:calc(12px * var(--oc-scale));">
        <span>{{t('section_advanced')}}</span>
      </div>
      <!-- (easing + autorotate moved up to the Animation sub-section; the old
           dead "Texture interpolation" select is gone entirely — the shader
           never read its header bits; the working texture cross-fade is the
           fade toggle in the Animated-texture block. cfg.interpolation is
           still encoded for byte-compat but has no effect.) -->
      <!-- oc-tour-flags: tour anchor (issue #4) — on the no-shadow / flip-uv / no-pow flags row -->
      <div class="oc-tour-flags" style="display:flex;flex-wrap:wrap;gap:10px 18px;">
        <label style="display:inline-flex;align-items:center;gap:6px;"><input v-model="noshadow" type="checkbox"/> <span>{{t('lbl_noshadow')}}</span><span class="oc-help" tabindex="0" :aria-label="help('noshadow')" :data-tip="help('noshadow')">?</span></label>
        <label style="display:inline-flex;align-items:center;gap:6px;"><input v-model="flipuv" type="checkbox"/> <span>{{t('lbl_flipuv')}}</span><span class="oc-help" tabindex="0" :aria-label="help('flipuv')" :data-tip="help('flipuv')">?</span></label>
        <label style="display:inline-flex;align-items:center;gap:6px;"><input v-model="nopow" type="checkbox"/> <span>{{t('lbl_nopow')}}</span><span class="oc-help" tabindex="0" :aria-label="help('nopow')" :data-tip="help('nopow')">?</span></label>
        <!-- filterArmature is now automatic -->
      </div>
    </div>
  </div>

  <!-- ======== FOOTER ======== -->
  <div v-if="validationErrors.length || status"
       class="oc-footer-sticky"
       style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-top:1px solid rgba(255,255,255,0.06);">
    <span v-if="validationErrors.length" class="oc-err-badge" :data-tip="errorBadgeTitle" @click="scrollToFirstError" style="cursor:pointer;">
      {{validationErrors.length}} {{tPlural(validationErrors.length, 'problems')}}
    </span>
    <span :style="{color: statusKind==='error'?'#f66' : statusKind==='done'?'#6f6' : statusKind==='cancelled'?'#fa6' : '#aaa', fontSize:'12px', flex:1, textAlign:'right'}">
      {{status}}
    </span>
  </div>

  <!-- ======== GUIDED TOUR OVERLAY (issue #4) ======== -->
  <!-- Single spotlight engine: a box-shadow "hole" positioned over the current
       step's target (its box-shadow IS the dim; its transparent center reveals
       the bright target), plus a narrating card. No separate full-screen dim —
       that would cover the target. Close via the card Skip/Got it buttons.
       positionTour() drives the geometry; tourSteps[tourIndex] the copy. -->
  <div v-if="tourActive" class="oc-tour-layer">
    <div id="oc-tour-hole" class="oc-tour-hole"></div>
    <div id="oc-tour-card" class="oc-tour-card">
      <div class="oc-tour-card-title">{{t(tourSteps[tourIndex].titleKey)}}</div>
      <div class="oc-tour-card-body">{{t(tourSteps[tourIndex].bodyKey)}}</div>
      <div class="oc-tour-card-foot">
        <span class="oc-tour-counter">{{t('tour_step').replace('{i}', tourIndex+1).replace('{n}', tourSteps.length)}}</span>
        <span class="oc-tour-card-btns">
          <button type="button" class="oc-btn oc-tour-skip" @click="tourEnd(true)">{{t('tour_skip')}}</button>
          <button type="button" class="oc-btn" v-if="tourIndex>0" @click="tourPrev">{{t('tour_back')}}</button>
          <button type="button" class="oc-btn oc-btn-primary" @click="tourNext">{{tourIndex >= tourSteps.length-1 ? t('tour_done') : t('tour_next')}}</button>
        </span>
      </div>
    </div>
  </div>

</div>`,
            },
            // Use BlockBench's native button bar for the primary Export +
            // Close — it's the only reliably pinned-to-bottom UI in a BB
            // Dialog. Our custom footer (sticky/flex) didn't survive BB's
            // own layout in the wild.
            buttons: [t('btn_export'), t('btn_close')],
            confirmIndex: 0,
            cancelIndex: 1,
            onConfirm: function () {
                const vm = this.content_vue;
                if (!vm) return;
                // Re-entrancy guard: the button stays clickable (we return false to keep the
                // dialog open), so without this a second click during an in-flight export
                // launches a concurrent run racing on the same files/status.
                if (vm.running) return false;
                if (vm.validationErrors.length) {
                    vm.scrollToFirstError();
                    return false;  // keep dialog open
                }
                vm.doExport();
                return false;  // keep open so user can see status / re-export
            },
        });

        dialog.show();
    }

    // =========================================================
    // Plugin Registration (at end of IIFE — see note near top of file)
    // =========================================================
    BBPlugin.register(PLUGIN_ID, {
        title: 'obj³',
        author: 'JagerMeistars, fork of Godlander\'s objmc',
        description: 'Export models, textures and animations to Minecraft resource packs',
        icon: 'data:image/png;base64,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',
        version: '0.9.7',
        min_version: '4.8.0',
        variant: 'desktop',
        onload() {
            this.exportAction = new Action(PLUGIN_ID + '_export', {
                name: 'Export as obj³…',
                description: 'Export the model to a Minecraft resource pack',
                icon: 'icon',
                click: showDialog,
            });
            MenuBar.addAction(this.exportAction, 'file.export');

            this.emissivePropCube = new Property(Cube, 'number', 'objcubed_light_emission', {
                default: 0,
            });
            if (typeof Mesh !== 'undefined') {
                this.emissivePropMesh = new Property(Mesh, 'number', 'objcubed_light_emission', {
                    default: 0,
                });
            }
            this._emissiveMenuItem = {
                name: t('menu_toggle_emissive'),
                icon: 'light_mode',
                condition: () => (OutlinerElement.selected || []).length > 0,
                click() {
                    const sel = OutlinerElement.selected || [];
                    if (!sel.length) return;
                    const anyOn = sel.some(el => el.objcubed_light_emission > 0);
                    const newVal = anyOn ? 0 : 15;
                    Undo.initEdit({ elements: sel });
                    sel.forEach(el => { el.objcubed_light_emission = newVal; });
                    Undo.finishEdit(t(newVal ? 'undo_emissive_on' : 'undo_emissive_off'));
                    Blockbench.showQuickMessage(t(newVal ? 'toast_emissive_on' : 'toast_emissive_off'), 1000);
                },
            };
            Cube.prototype.menu.structure.unshift(this._emissiveMenuItem);
            if (typeof Mesh !== 'undefined') Mesh.prototype.menu.structure.unshift(this._emissiveMenuItem);

            // Per-piece armor: tag a GROUP (bone) with the body part its geometry rides,
            // via right-click "obj³: Body part ▸ …" (mirrors the emissive toggle). The
            // exporter reads objcubed_body_part to route each face to its part.
            if (typeof Group !== 'undefined') {
                this._bodyPartProp = new Property(Group, 'number', 'objcubed_body_part', { default: -1 });
                this._equipmentPartProp = new Property(Group, 'string', 'objcubed_equipment_part', {default:''});
                this._equipmentRestProp = new Property(Group, 'object', 'objcubed_equipment_rest', {default:{}});
                this._equipmentPartMenuItem = {
                    name: t('menu_equipment_part'), icon: 'pets',
                    children: [['', [t('bp_none'),t('bp_none')]], ...Object.entries(EQUIPMENT_PART_LABELS).filter(([part]) => Object.values(EQUIPMENT_CARRIERS).some(c => Object.prototype.hasOwnProperty.call(c.bindings,part)))].map(([part, labels]) => ({
                        name: equipmentLabel(labels),
                        click(group) {
                            const g=group || (Group.all || []).find(x=>x.selected);
                            if(!g) return;
                            Undo.initEdit({groups:[g]});
                            g.objcubed_equipment_part=part;
                            Undo.finishEdit(t('menu_equipment_part'));
                            Blockbench.showQuickMessage(`${g.name}: ${equipmentLabel(labels)}`,1500);
                        },
                    })),
                };
                if(Group.prototype.menu) Group.prototype.menu.structure.unshift(this._equipmentPartMenuItem);
                // [i18n key, body-part id]. Label text comes from t() so the menu and
                // its toast follow the active language.
                const OC_BODY_PARTS = [
                    ['bp_none', -1], ['bp_head', 1], ['bp_body', 0], ['bp_waist', 8], ['bp_arm_r', 2], ['bp_arm_l', 3],
                    ['bp_leg_r', 4], ['bp_leg_l', 5], ['bp_foot_r', 6], ['bp_foot_l', 7],
                ];
                this._bodyPartMenuItem = {
                    name: t('menu_body_part'),
                    icon: 'accessibility_new',
                    condition: () => (Group.all || []).length > 0,
                    children: OC_BODY_PARTS.map(([labelKey, id]) => ({
                        name: t(labelKey),
                        click(group) {
                            // Tag ONLY the right-clicked group (avoids the "tagged
                            // everything because several groups were selected" trap).
                            const g = group || (Group.all || []).find(x => x.selected);
                            if (!g) return;
                            // {groups:[g]} snapshots the Group's registered Properties (incl.
                            // objcubed_body_part) so undo reverts the tag; {outliner:true} only
                            // captured tree structure, leaving the tag stuck after undo.
                            Undo.initEdit({ groups: [g] });
                            g.objcubed_body_part = id;
                            Undo.finishEdit(t('undo_bodypart'));
                            Blockbench.showQuickMessage(
                                t('toast_bodypart').replace('{name}', g.name).replace('{part}', t(labelKey)), 1500);
                        },
                    })),
                };
                if (Group.prototype.menu) Group.prototype.menu.structure.unshift(this._bodyPartMenuItem);
            }

            installProjectPersistence();
            installStylesheet();
        },
        onunload() {
            if (this.exportAction) this.exportAction.delete();
            if (this._emissiveMenuItem) {
                for (const cls of [Cube, typeof Mesh !== 'undefined' ? Mesh : null]) {
                    if (!cls) continue;
                    const s = cls.prototype.menu.structure;
                    const idx = s.indexOf(this._emissiveMenuItem);
                    if (idx >= 0) s.splice(idx, 1);
                }
            }
            if (this.emissivePropCube) this.emissivePropCube.delete();
            if (this.emissivePropMesh) this.emissivePropMesh.delete();
            if (this._bodyPartMenuItem && typeof Group !== 'undefined' && Group.prototype.menu) {
                const gs = Group.prototype.menu.structure;
                const gi = gs.indexOf(this._bodyPartMenuItem);
                if (gi >= 0) gs.splice(gi, 1);
            }
            if (this._bodyPartProp) this._bodyPartProp.delete();
            if (this._equipmentPartMenuItem && typeof Group !== 'undefined' && Group.prototype.menu) {
                const menu=Group.prototype.menu.structure, index=menu.indexOf(this._equipmentPartMenuItem);
                if(index>=0) menu.splice(index,1);
            }
            if(this._equipmentPartProp) this._equipmentPartProp.delete();
            if(this._equipmentRestProp) this._equipmentRestProp.delete();
            uninstallProjectPersistence();
            uninstallStylesheet();
        },
    });

    // ── Test hook ──────────────────────────────────────────────────────────
    // Inert inside Blockbench (the editor has no CommonJS `module` global at
    // load time). Under the Node/vitest harness this exposes the plugin's pure
    // functions for autonomous tests. See test/helpers/load-plugin.cjs.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports.__test = {
            generateDatapackFiles, buildItemSelector, mergeItemSelector, saveSingleOutput, buildOutput,
            buildSlotModelJson,
            buildVertexData, buildDisplayTransforms, hasStaticWorldDisplay,
            ensureDataRoot, loadActiveSettings, saveActiveSettings,
            computePartCenters, buildFaceToPart, collectBodyPartTags, applyBodyPartTags, parseFaceToken,
            collectEquipmentPartTags, applyEquipmentPartTags, equipmentBindingOfElement, buildFaceEquipmentBindings,
            collectEquipmentRestTransforms, applyEquipmentRestTransforms, validateEquipmentRestBasis,
            equipmentCarrierInRestBasis, installProjectPersistence, uninstallProjectPersistence,
            planAnimalLayers, encodeAnimalLayer, equipmentOf, equipmentParts, ANIMAL_EQUIPMENT, EQUIPMENT_CARRIERS,
            calibratedElementsForSlot, assignSlotMarkers,
            buildItemTransformMatrix, activeSlotPrefixFor,
            parseObj, parseMtl, posPixels, uvPixels, vertPixels, atlasTexIndicesFrom, frameCountOf,
            buildAtlas,
            compileAnimatedObjFrames, collectExportCameras, sampleExportCamera, addCameraDatapack,
            encodePNG, estimateOutputPng, t, LANG, PERSISTABLE_FIELDS,
            surfaceWarning, pluralForm, tPlural,
            UI_SCALE,
            TOUR_STEPS, TOUR_STEP_KEYS,
        };
    }

})();
