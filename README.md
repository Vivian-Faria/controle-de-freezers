# Gestao de Freezers

Aplicacao para controlar salas, freezers, clientes, ocupacao em cm, custos dos equipamentos e faturamento por espaco locado.

Os dados compartilhados ficam no Firebase Cloud Firestore. O Netlify hospeda a tela.

## Configurar Firebase

1. No Firebase Console, crie ou abra seu projeto.
2. Crie um app Web.
3. Copie o `firebaseConfig`.
4. Substitua os valores em `firebase-config.js`.
5. Ative o Cloud Firestore.
6. Publique regras iguais ou equivalentes a `firestore.rules`.

Exemplo de `firebase-config.js`:

```js
window.FIREBASE_CONFIG = {
  apiKey: "SUA_CHAVE",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:000000000000"
};
```

Importante: as regras em `firestore.rules` deixam leitura e escrita abertas no documento do sistema. Isso facilita a primeira versao, mas qualquer pessoa com o link podera alterar os dados. Para uso real com permissao de edicao restrita, o proximo passo recomendado e adicionar login com Firebase Authentication.

## Deploy no Netlify

Suba esta pasta completa para o GitHub e conecte o repositorio no Netlify.

Configuracoes no Netlify:

```text
Build command: deixe vazio
Publish directory: .
```

Na primeira abertura do site publicado, se o documento ainda nao existir no Firestore, o app usa `data.json` como carga inicial. Depois disso, os cadastros ficam salvos no Firestore e ficam visiveis para todos que abrirem o mesmo link.

## Arquivos principais

```text
index.html
styles.css
app.js
data.json
package.json
netlify.toml
firebase-config.js
firestore.rules
README.md
```

## Uso local compartilhado

Se quiser rodar na rede local antes de publicar:

```powershell
node server.js
```

Ou abra:

```text
iniciar_app_compartilhado.bat
```

No computador principal, acesse:

```text
http://localhost:4174
```

Em outros computadores na mesma rede, use o IP do computador principal:

```text
http://IP-DO-COMPUTADOR:4174
```

Os dados ficam salvos em `data.json`.
