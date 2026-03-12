//objmc
//https://github.com/Godlander/objmc

//default lighting
if (isCustom == 0) {
#ifndef EMISSIVE
    color *= lightColor;
#endif
#ifdef PER_FACE_LIGHTING
    color *= (gl_FrontFacing ? vertexPerFaceColorFront : vertexPerFaceColorBack);
#else
    color *= vertexColor;
#endif
#ifdef ENTITY
#ifndef NO_OVERLAY
    color.rgb = mix(overlayColor.rgb, color.rgb, overlayColor.a);
#endif
    color *= ColorModulator;
#endif
}
//custom lighting
else if (noshadow == 0) {
    //normal from position derivatives
    vec3 normal = normalize(cross(dFdx(Pos), dFdy(Pos)));

    //block lighting
#ifdef BLOCK
    float vertical = sign(normal.y) * 0.3 + 0.7;
    float horizontal = abs(normal.z) * 0.25 + 0.5;
    float brightness = mix(horizontal, vertical, abs(normal.y));
    color *= vec4(vec3(brightness), 1.0);
#endif

    //entity lighting
#ifdef ENTITY
    //flip normal for gui
    if (isGUI == 1) normal.y *= -1;
    color *= minecraft_mix_light(Light0_Direction, Light1_Direction, normal, overlayColor);
#endif

    color *= lightColor;
}