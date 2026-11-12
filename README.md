# Catálogos MIZ

Painel para publicar catálogos em PDF como páginas web em alta resolução.
A designer envia o PDF, clica em **Gerar link** e manda o link para a cliente,
que folheia o catálogo no celular ou no computador sem baixar o arquivo.

- **Painel:** `https://SEU-DOMINIO/admin`
- **Catálogo:** `https://SEU-DOMINIO/c/nome-do-catalogo`

## Como funciona

1. A designer envia o PDF no painel.
2. O servidor converte cada página em WebP de alta resolução (3200 px no lado
   maior, qualidade 90), além de miniaturas, uma prévia desfocada para o
   carregamento e a capa usada no preview do WhatsApp.
3. A cliente abre o link, vê a primeira página em segundos e as próximas são
   baixadas antes de ela chegar nelas. Zoom com pinça, duplo toque ou roda do
   mouse. No computador, as páginas aparecem lado a lado como numa revista.

**Substituir PDF** mantém o mesmo link. A versão antiga continua no ar até a
nova ficar pronta.

## Acessos iniciais

O painel já vem com duas usuárias: `ludmila@usemiz.com` e `bruna@usemiz.com`.
A senha provisória foi combinada fora deste arquivo; aqui só fica o hash, em
`config/seed-users.json`. No primeiro login, o painel obriga cada uma a criar
uma senha nova.

> Os usuários são criados só na **primeira** inicialização, quando ainda não
> existe `/data/users.json`. Depois disso, o que vale é o arquivo do volume.

---

## Publicar no Easypanel

### 1. Subir o código para o GitHub

Crie um repositório **privado** no GitHub e envie esta pasta. O `.gitignore`
já deixa de fora `node_modules` e `data`.

### 2. Criar o app

1. No Easypanel, abra (ou crie) um projeto e clique em **+ Service → App**.
2. Dê o nome `catalogos`.
3. Em **Source**, escolha **GitHub**, selecione o repositório e a branch `main`.
4. Em **Build**, escolha **Dockerfile** (o arquivo já está na raiz).

### 3. Volume (obrigatório)

Em **Mounts → Add Volume Mount**:

| Campo      | Valor   |
|------------|---------|
| Name       | `data`  |
| Mount Path | `/data` |

Sem o volume, os catálogos e as senhas somem a cada deploy.

### 4. Variáveis de ambiente

Em **Environment**:

```
PUBLIC_URL=https://catalogo.seudominio.com.br
```

Opcionais:

| Variável        | Padrão | Para que serve |
|-----------------|--------|----------------|
| `PAGE_SIZE`     | `3200` | Lado maior de cada página, em px |
| `WEBP_QUALITY`  | `90`   | Qualidade das imagens (1–100) |
| `MAX_UPLOAD_MB` | `1024` | Tamanho máximo do PDF |
| `BRAND_NAME`    | `MIZ`  | Nome no topo do visualizador |

### 5. Domínio

1. No seu provedor de DNS, crie um registro **A**: `catalogo` → IP da VPS.
2. No app, em **Domains → Add Domain**: `catalogo.seudominio.com.br`, porta
   **3000**, HTTPS ligado. O certificado é emitido sozinho.

> **Se o domínio usa Cloudflare:** deixe esse registro como **DNS only**
> (nuvem cinza). No plano gratuito, a Cloudflare bloqueia uploads acima de
> 100 MB, e o PDF da Coleção Fluxo 02 tem cerca de 102 MB.

### 6. Recursos

A conversão usa bastante memória por alguns minutos. Recomendado: pelo menos
**2 GB de RAM** livres para o app. Um PDF de cerca de 100 páginas leva poucos
minutos para ficar pronto; o link já funciona e mostra "em preparação" até lá.

### 7. Deploy

Clique em **Deploy**. Quando terminar, acesse `https://catalogo.seudominio.com.br/admin`.

---

## Rodar no computador (teste)

```bash
npm install
```

```bash
npm start
```

Abra http://localhost:3000/admin. Os dados ficam na pasta `data/`.

## Estrutura

```
src/server.js          rotas, upload e páginas públicas
src/auth.js            login, sessões e troca de senha
src/catalogs.js        cadastro dos catálogos e fila de conversão
src/convert-worker.js  conversão PDF → WebP (processo separado)
src/viewer-page.js     HTML do catálogo público
public/admin.html      painel
public/assets/         JS/CSS do painel e do visualizador
config/seed-users.json usuárias iniciais (senha em hash)
```

Dados (volume `/data`):

```
users.json, catalogs.json, secret.key
originals/<id>.pdf           PDF original
media/<id>/v<n>/pages/*.webp páginas em alta resolução
media/<id>/v<n>/thumbs/*     miniaturas
media/<id>/v<n>/og.jpg       capa para o preview do link
```

## Licença do conversor

A conversão usa a biblioteca [MuPDF](https://mupdf.com) (pacote `mupdf`),
licenciada sob AGPL. Para uso interno da empresa isso não costuma ser problema;
para revender o sistema, avalie a licença comercial da Artifex.
