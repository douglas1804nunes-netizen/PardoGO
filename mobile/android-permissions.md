# Permissões Android recomendadas

Quando o projeto Android for gerado pelo Capacitor, confira o arquivo `android/app/src/main/AndroidManifest.xml`.

Permissões recomendadas para o MVP:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

Observações:

- `INTERNET` é necessária para API online, mapa e tempo real.
- `ACCESS_FINE_LOCATION` melhora a precisão da origem e da posição do motorista.
- Antes de publicar, a descrição de uso da localização deve estar clara nos Termos e Privacidade.
