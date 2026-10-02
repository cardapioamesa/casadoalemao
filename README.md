# Cardápio digital — Casa do Alemão

Cardápio online da Casa do Alemão, feito pelo **Cardápio à Mesa**. O cliente abre pelo
QR Code da mesa ou pelo link da bio; o dono atualiza pelo celular, na
**Área do dono**, com e-mail e senha.

**Endereço:** https://cardapioamesa.github.io/casadoalemao/

## Como funciona

A página é estática (GitHub Pages) e busca o cardápio no **Firebase Firestore**.
O dono entra com e-mail e senha do **Firebase Auth**, edita no painel e clica em
**Publicar**: a mudança vai para o banco e aparece na hora para quem está com o
cardápio aberto.

| Arquivo | O que é |
|---|---|
| `index.html` | A página: estilo e estrutura |
| `app.js` | Lê o cardápio, desenha a página, painel do dono e publicação |
| `mesa.js` + `mesa.css` | Pedido na mesa: comanda, painel de pedidos, mesas e caixa |
| `config.js` | Qual restaurante e qual projeto do Firebase |
| `firestore.rules` | Quem pode ler e escrever — colar no console do Firebase |
| `semear.html` + `semente.js` | Carga inicial do cardápio no banco (uma vez, pelo administrador) |
| `gerar_semente.py` | Gera o `semente.js`: todo o cardápio impresso, com as fotos de `img/p-*.jpg` |
| `img/` | Marca, fachada, capas das seções (`capa-*.webp`) e fotos dos pratos (`p-*.jpg`) |

### Onde ficam os dados

```
restaurantes/casadoalemao                          textos, seções, logo         leitura pública
restaurantes/casadoalemao/itens/{id}               um prato por documento       leitura pública
restaurantes/casadoalemao/mesas/{id}               uma mesa por documento       leitura pública
restaurantes/casadoalemao/comandas/{id}            a conta aberta de uma mesa   ver abaixo
restaurantes/casadoalemao/comandas/{id}/rodadas/…  cada pedido daquela mesa     ver abaixo
restaurantes/casadoalemao/privado/acesso           e-mails de quem pode editar  só dono e administrador
```

As fotos ficam dentro do próprio documento do prato, já comprimidas (a maior tem
uns 30 KB; o limite do Firestore é 1 MB por documento). Isso evita o Cloud
Storage, que em projeto novo exige o plano pago.

## Como o cardápio está organizado

Cada seção tem um estilo, escolhido no `gerar_semente.py`:

| Estilo | Para quê | Onde |
|---|---|---|
| `destaque` | cartões com foto grande | Sugestões da casa |
| `carta` | nome, descrição e preço, como no cardápio impresso | sanduíches, principais, café, doces |
| `lista` | linhas curtas com pontilhado | bebidas, cervejas, adicionais |
| `quadro` | só texto, em caixas | acompanhamentos e molhos |

Uma seção `carta` com `colunas` mostra **dois preços por item**: `preco` na
primeira coluna e `preco2` na segunda (pão careca ou francês / brioche de
queijo; simples / especial). No pedido na mesa o cliente escolhe a opção, e ela
entra no nome do pedido ("Linguiça (Brioche de queijo)").

A `capa` de cada seção é um arquivo em `img/` (não vem do banco): trocar exige
mexer no repositório. As fotos dos itens ficam no banco e o dono troca pelo
painel.

Fontes: fotos do cardápio impresso (02/10/2026) e o site oficial
casadoalemao.com.br (fotos de produto, logo, fachada e história).

## Pedido na mesa

O cliente abre o QR da mesa (`.../?mesa=3`), pede pelo celular e o pedido cai no
painel do dono, que confirma. **Uma comanda por mesa**: todos os celulares da
mesa somam na mesma conta, e só o dono fecha.

Duas chaves precisam estar ligadas para o cliente ver o botão de pedir:

| Chave | Quem muda | Onde |
|---|---|---|
| `pedidoNaMesa` | o dono | interruptor no painel, bloco "Pedido na mesa" |
| `pedidoAte` | o administrador | mesmo bloco, campo de data (só aparece para o admin) |

Sem `pedidoAte`, ou passada a data, o servidor recusa qualquer pedido novo —
não adianta o que estiver aberto no celular de quem for. Desligado, o cardápio
fica exatamente como era antes: o cliente só vê os pratos.

O dono cadastra as mesas no painel e baixa o **cartaz com o QR** de cada uma.
"Caixa do dia" soma as comandas fechadas de hoje: total, ticket médio, o que
mais saiu e a conta de cada mesa. É controle interno, não documento fiscal.

**Atenção:** depois de mexer em `firestore.rules`, publique no console do
Firebase, senão o pedido na mesa não funciona (e o cardápio continua normal).

## Ao publicar uma mudança no código

O GitHub Pages manda o navegador guardar os arquivos por 10 minutos. Ao mexer
em `app.js`, `mesa.js`, `mesa.css` ou `config.js`, **suba o número de versão** nos `<script>` do
`index.html` (`app.js?v=2` → `app.js?v=3`): com o endereço novo, o navegador
baixa o arquivo de novo na hora. Mudanças feitas pelo painel do dono não
precisam disso — elas vêm do banco.

## Segurança

- Quem confere a senha é o servidor do Google, não a página.
- Quem pode gravar é decidido pelas **regras do Firestore**, no servidor: só os
  e-mails da lista `privado/acesso` daquele restaurante, e o administrador.
  Mesmo que alguém abra o painel mexendo no código, o banco recusa a gravação.
- Os e-mails dos donos ficam num documento que ninguém de fora consegue ler.
- O `config.js` **não é segredo**: identifica o projeto, como em qualquer site
  que usa Firebase.
- A criação de conta pelo próprio usuário fica **desligada** no console: só
  existem as contas que o administrador cadastra.
- Nenhum dado pessoal entra neste repositório (ele é público). O administrador é
  identificado nas regras pelo UID, um código opaco do Firebase.

## Novo restaurante

1. Novo repositório na organização, com o nome do restaurante (`pizzaria-do-ze`).
2. Copiar estes arquivos, trocar `restaurante` no `config.js` e as fotos em `img/`.
3. Configurar a autoria só naquele repositório, antes do primeiro commit:
   `git config --local user.name "Cardápio à Mesa"` e
   `git config --local user.email "cardapioamesa@users.noreply.github.com"`.
4. Gerar o `semente.js`, publicar e carregar pelo `semear.html`.
5. Cadastrar o login do dono no console e colocar o e-mail dele na carga.

O mesmo projeto do Firebase atende todos os restaurantes: as regras separam um
do outro pelo nome.
