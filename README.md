# Catálogos MIZ e Mark

Painel único para publicar catálogos em PDF como páginas web em alta resolução,
para as duas marcas. A designer envia o PDF, clica em **Gerar link** e manda o
link para a cliente, que folheia o catálogo no celular ou no computador sem
baixar o arquivo.

| Marca | Painel | Link do catálogo |
|-------|--------|------------------|
| MIZ   | `https://catalogo.usemiz.com/admin` | `https://catalogo.usemiz.com/c/nome-do-catalogo` |
| Mark  | `https://catalogo.marktextil.com.br/admin` | `https://catalogo.marktextil.com.br/c/nome-do-catalogo` |

O painel é o mesmo nos dois endereços: um único login, com a troca de marca
no topo. A diferença é só a logo da tela de entrada e o ícone da aba.

## Como funciona

1. **Marcas:** cada catálogo pertence a uma marca. O link sai com o domínio
   dela, e o visualizador usa a logo e o ícone dela. Um link da MIZ aberto no
   domínio da Mark (ou o contrário) é redirecionado para o domínio certo.
2. **Pastas, como num drive:** pastas e subpastas sem limite de níveis
   (ex.: Coleção Fluxo › Fluxo 1). Dá para renomear, mover e excluir pastas,
   mover catálogos pelo botão **Mover** ou arrastando para uma pasta ou para o
   caminho no topo, e buscar em todas as pastas.
3. **Envio:** o PDF vai para a pasta aberta. Também dá para soltar o arquivo em
   qualquer lugar do painel.
4. **Conversão:** o servidor converte cada página em WebP de alta resolução
   (3200 px no lado maior, qualidade 90), além de miniaturas, uma prévia
   desfocada para o carregamento e a capa usada no preview do WhatsApp.
5. **Visualização:** a cliente vê a primeira página em segundos, e as próximas
   são baixadas antes de ela chegar nelas. Zoom com pinça, duplo toque ou roda
   do mouse. No computador, as páginas aparecem lado a lado como numa revista.

**Substituir PDF** mantém o mesmo link. A versão antiga continua no ar até a
nova ficar pronta.

**Excluir uma pasta** exclui também as subpastas e os catálogos dentro dela. O
painel avisa quantos itens serão apagados antes de confirmar.

## Acessos

O painel já vem com duas usuárias: `ludmila@usemiz.com` e `bruna@usemiz.com`.
A senha provisória foi combinada fora deste arquivo; aqui só fica o hash, em
`config/seed-users.json`. No primeiro login, o painel obriga cada uma a criar
uma senha nova.

As duas enxergam as duas marcas. Para limitar alguém a uma marca, adicione
`"brands": ["miz"]` (ou `["mark"]`) à usuária em `/data/users.json` e
reinicie o app.

> Os usuários são criados só na **primeira** inicialização, quando ainda não
> existe `/data/users.json`. Depois disso, o que vale é o arquivo do volume.

---

## Publicar no Easypanel

### 1. App

No Easypanel: **+ Service → App**, Source **GitHub** (repositório
`usemizdevelopers/miz-catalogos`, branch `main`), Build **Dockerfile**.

### 2. Volume (obrigatório)

Em **Mounts → Add Volume Mount**:

| Campo      | Valor   |
|------------|---------|
| Name       | `data`  |
| Mount Path | `/data` |

Sem o volume, os catálogos e as senhas somem a cada deploy.

### 3. Variáveis de ambiente

Em **Environment** (estes já são os valores padrão; só mude se o domínio mudar):

```
PUBLIC_URL_MIZ=https://catalogo.usemiz.com
PUBLIC_URL_MARK=https://catalogo.marktextil.com.br
```

> A variável antiga `PUBLIC_URL` continua valendo para a MIZ.

Opcionais:

| Variável        | Padrão | Para que serve |
|-----------------|--------|----------------|
| `DEFAULT_BRAND` | `miz`  | Marca usada quando o painel é aberto por outro endereço |
| `PAGE_SIZE`     | `3200` | Lado maior de cada página, em px |
| `WEBP_QUALITY`  | `90`   | Qualidade das imagens (1–100) |
| `MAX_UPLOAD_MB` | `1024` | Tamanho máximo do PDF |

### 4. Domínios

Os dois domínios apontam para o **mesmo app**, na porta **80**.

1. **DNS:** em cada domínio, crie um registro **A** `catalogo` apontando para o
   IP da VPS. Os dois domínios usam a Cloudflare: deixe o registro como
   **DNS only** (nuvem cinza). No plano gratuito, a Cloudflare bloqueia
   uploads acima de 100 MB.
2. **Easypanel:** no app, em **Domains → Add Domain**, adicione
   `catalogo.usemiz.com` e `catalogo.marktextil.com.br`, os dois na porta
   **80** e com HTTPS ligado. O certificado é emitido sozinho.

### 5. Recursos

A conversão usa bastante memória por alguns minutos. Recomendado: pelo menos
**2 GB de RAM** livres para o app. Um PDF de cerca de 100 páginas leva poucos
minutos para ficar pronto; o link já funciona e mostra "em preparação" até lá.

### 6. Deploy

Clique em **Deploy**. Os catálogos que já existiam passam a ser da MIZ e
ficam no Início da MIZ.

---

## Rodar no computador (teste)

```bash
npm install
```

```bash
npm start
```

Abra http://localhost:3000/admin. Os dados ficam na pasta `data/`. Em teste
local, os links usam `localhost` em vez do domínio da marca.

## Estrutura

```
src/server.js          rotas, upload e páginas públicas
src/brands.js          marcas: domínio, logo e ícones
src/folders.js         pastas e subpastas
src/catalogs.js        cadastro dos catálogos e fila de conversão
src/auth.js            login, sessões e troca de senha
src/convert-worker.js  conversão PDF → WebP (processo separado)
src/viewer-page.js     HTML do catálogo público
public/admin.html      painel
public/assets/         JS/CSS do painel e do visualizador
public/assets/brands/  logos e ícones de cada marca
config/seed-users.json usuárias iniciais (senha em hash)
```

Dados (volume `/data`):

```
users.json, catalogs.json, folders.json, secret.key
originals/<id>.pdf           PDF original
media/<id>/v<n>/pages/*.webp páginas em alta resolução
media/<id>/v<n>/thumbs/*     miniaturas
media/<id>/v<n>/og.jpg       capa para o preview do link
```

## Licença do conversor

A conversão usa a biblioteca [MuPDF](https://mupdf.com) (pacote `mupdf`),
licenciada sob AGPL. Para uso interno da empresa isso não costuma ser problema;
para revender o sistema, avalie a licença comercial da Artifex.
