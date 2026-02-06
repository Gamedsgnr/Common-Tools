const hlslData = [
    {
        "id": "hlsl_example_01",
        "title": "Custom Rotator",
        "lang": "hlsl",
        "desc": "Матрица вращения UV координат внутри Custom Node.",
        "code": "float2 CustomUV = (UV - 0.5);\nfloat C = cos(Angle);\nfloat S = sin(Angle);\nreturn float2(dot(CustomUV, float2(C, -S)), dot(CustomUV, float2(S, C))) + 0.5;"
    }
];