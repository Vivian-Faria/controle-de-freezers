# Gestao de Freezers

Aplicacao para controlar salas, freezers, clientes, ocupacao em cm, custos dos equipamentos e faturamento por espaco locado.

## Deploy no Netlify

Suba esta pasta completa para o GitHub e conecte o repositorio no Netlify.

Configuracoes:

```text
Build command: npm install
Publish directory: .
Functions directory: netlify/functions
```

O arquivo `netlify.toml` ja deixa essas rotas configuradas:

```text
/api/data -> /.netlify/functions/data
```

Os dados compartilhados ficam salvos no Netlify Blobs. Na primeira abertura do site publicado, a Function usa `data.json` como carga inicial. Depois disso, os cadastros feitos pelo app passam a ser salvos no armazenamento compartilhado do Netlify e ficam visiveis para todos que abrirem o mesmo link.

## Arquivos principais

```text
index.html
styles.css
app.js
data.json
package.json
netlify.toml
netlify/functions/data.mjs
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
