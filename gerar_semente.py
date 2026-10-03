# Gera semente.js: o cardápio inicial da Casa do Alemão (textos, seções, pratos e
# fotos) que a página semear.html grava no Firestore uma única vez.
#
# Fontes: as fotos do cardápio impresso (02/10/2026) e o site oficial
# casadoalemao.com.br (fotos de produto, história e identidade).
#
# Tudo aqui já é público — é o próprio cardápio. Nenhum e-mail ou senha entra
# neste arquivo: os e-mails dos donos são digitados na hora, em semear.html.
import base64, io, json, os
from PIL import Image, ImageOps

BASE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(BASE, "img")
URL_PUBLICA = "https://cardapioamesa.github.io/casadoalemao/"


def foto(nome, w=560, q=76):
    """foto deitada 4:3, em JPEG, dentro do documento do item"""
    im = Image.open(os.path.join(IMG, nome)).convert("RGB")
    im = ImageOps.fit(im, (w, w * 3 // 4), Image.LANCZOS) if im.width >= w else im
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


PAO = ["Pão careca ou francês", "Brioche de queijo"]
PRATO = ["Simples", "Especial"]
NOTA_PRINCIPAIS = "Simples: 2 acompanhamentos simples (não repetidos) + 1 molho.\nEspecial: 1 acompanhamento especial + 1 simples + 1 molho."

# (id, nome, aba, sobre, estilo, nota, extras)
SECOES = [
    ("sugestoes", "Sugestões da casa", "Sugestões", "Os clássicos", "destaque",
     "Sanduíches com nome de cidade alemã — e a cerveja da casa, feita em Petrópolis.", {}),
    ("sanduiches", "Sanduíches", "", "Feitos na hora", "carta",
     "Escolha o pão: careca ou francês, ou o brioche de queijo.",
     {"colunas": PAO, "capa": "img/capa-sanduiches.webp"}),
    ("hamburguer", "Hambúrguer", "", "Na chapa", "carta", "", {}),
    ("adicionais", "Complemente o seu sanduíche", "Adicionais", "Adicionais", "lista", "", {}),
    ("salgados", "Salgados", "", "Do forno e da fritadeira", "carta",
     "O croquete que fez a fama da casa.", {"capa": "img/capa-salgados.webp"}),
    ("porcoes", "Porções", "", "Para dividir", "carta",
     "Da nossa salsicharia, com receita própria.", {"capa": "img/capa-porcoes.webp"}),
    ("bovina", "Carne bovina", "", "Principais", "carta", NOTA_PRINCIPAIS, {"colunas": PRATO}),
    ("suina", "Carne suína", "", "Principais", "carta", "", {"colunas": PRATO}),
    ("frango", "Frango", "", "Principais", "carta", "", {"colunas": PRATO}),
    ("peixes", "Peixes e frutos do mar", "Peixes", "Principais", "carta", "", {"colunas": PRATO}),
    ("acompanhamentos", "Acompanhamentos e molhos", "Acompanhamentos", "Para os principais", "quadro",
     "Arroz e feijão inclusos — peça na hora de fazer o pedido.",
     {"quadros": [
         {"titulo": "Acompanhamentos simples",
          "texto": "Chucrute, salada verde, salada de batata, batata rostie, batata frita (palito), purê de batata, farofa, arroz de brócolis ou de passas."},
         {"titulo": "Acompanhamentos especiais",
          "texto": "Salada caprese, arroz à piamontese, purê queijudo, batata portuguesa, risoto de limão siciliano, caponata de legumes."},
         {"titulo": "Molhos",
          "texto": "Madeira, chimichurri, bechamel, poivre, laranja, alcaparras, mostarda Dijon, mostarda com mel, vinagre balsâmico, barbecue, maracujá, molho capixaba e molho à campanha."},
     ]}),
    ("bebidas", "Bebidas", "", "Geladas", "lista", "", {}),
    ("cervejas", "Cervejas e chopp", "Cervejas", "Bem tirado", "lista",
     "Se beber, não dirija.", {"capa": "img/capa-cervejas.webp"}),
    ("cafe", "Café", "", "Para acompanhar", "carta",
     "A torrada Petrópolis é feita com o pão de forma da casa.", {"capa": "img/capa-cafe.webp"}),
    ("sorvetes", "Sorvetes", "", "Sobremesa gelada", "carta",
     "Sabores: creme, morango, chocolate, flocos, coco, abacaxi, milho verde, doce de leite, cheesecake de morango e cheesecake de goiabada.", {}),
    ("doces", "Doces", "", "Da confeitaria", "carta",
     "Receitas tradicionais da casa, feitas na nossa fábrica.", {"capa": "img/capa-doces.webp"}),
]

# (id, seção, nome, descrição, preço, preço 2, etiqueta, foto)
# Preço vazio = ilegível na foto do cardápio impresso: o dono confere e preenche.
ITENS = [
    # ----- sugestões -----
    ("sug-munique",   "sugestoes", "Munique",    "Sanduíche de frios Lyoner com patê no pão integral.", "31,70", "", "", "p-munique.jpg"),
    ("sug-berlim",    "sugestoes", "Berlim",     "Sanduíche de lombinho defumado com queijo prato e abacaxi no pão careca.", "37,30", "", "", "p-lombinho.jpg"),
    ("sug-frankfurt", "sugestoes", "Frankfurt",  "Sanduíche de pernil assado com queijo prato e abacaxi no pão careca.", "37,30", "", "", "p-trio.jpg"),
    ("sug-nuremberg", "sugestoes", "Nuremberg",  "Sanduíche de lagarto defumado com cream cheese no pão careca.", "31,60", "", "", "p-defumado.jpg"),
    ("sug-light",     "sugestoes", "Light",      "Sanduíche de peito de peru com queijo minas no pão integral.", "32,20", "", "", None),
    ("sug-lager",     "sugestoes", "Casa do Alemão Lager", "A cerveja da casa: clara, puro malte, de Petrópolis. Garrafa de 500 ml.", "22,50", "", "", "p-lager.jpg"),

    # ----- sanduíches (pão careca ou francês / brioche de queijo) -----
    ("san-pate",       "sanduiches", "Patê", "", "25,20", "32,20", "", None),
    ("san-lyoner",     "sanduiches", "Frios Lyoner", "", "25,90", "32,90", "", None),
    ("san-lombinho",   "sanduiches", "Lombinho defumado", "", "27,00", "34,00", "", "p-lombinho.jpg"),
    ("san-lagarto",    "sanduiches", "Lagarto defumado", "", "27,00", "34,00", "", None),
    ("san-costela",    "sanduiches", "Costela", "Suína ou bovina.", "39,00", "46,00", "", None),
    ("san-lingua",     "sanduiches", "Língua defumada", "", "27,00", "34,00", "", None),
    ("san-linguica",   "sanduiches", "Linguiça", "Carne ou frango.", "25,90", "32,90", "Famoso da casa", "p-linguica.jpg"),
    ("san-picante",    "sanduiches", "Linguiça suína picante", "", "25,90", "32,90", "", None),
    ("san-presunto",   "sanduiches", "Presunto", "", "20,00", "27,00", "", None),
    ("san-frango",     "sanduiches", "Peito de frango", "", "27,00", "34,00", "", None),
    ("san-peru",       "sanduiches", "Peito de peru defumado", "", "27,00", "34,00", "", None),
    ("san-pernil",     "sanduiches", "Pernil assado", "", "27,00", "34,00", "", None),
    ("san-salsicha",   "sanduiches", "Salsicha", "Viena ou branca.", "25,90", "32,90", "", "p-salsicha.jpg"),
    ("san-salsichao",  "sanduiches", "Salsichão", "Viena ou branco.", "25,90", "32,90", "", None),
    ("san-misto",      "sanduiches", "Misto quente", "", "20,00", "27,00", "", None),
    ("san-queijo",     "sanduiches", "Queijo", "Minas ou prato.", "20,00", "27,00", "", None),
    ("san-mignon",     "sanduiches", "Filé mignon", "", "43,00", "50,00", "", None),

    ("ham-blend", "hamburguer", "Hambúrguer", "Blend de carne bovina no pão com gergelim.", "35,00", "", "", None),

    ("ad-pate",     "adicionais", "Patê", "", "5,80", "", "", None),
    ("ad-minas",    "adicionais", "Queijo minas", "", "5,20", "", "", None),
    ("ad-cheddar",  "adicionais", "Queijo cheddar", "", "5,20", "", "", None),
    ("ad-prato",    "adicionais", "Queijo prato", "", "5,20", "", "", None),
    ("ad-ovo",      "adicionais", "Ovo", "", "4,60", "", "", None),
    ("ad-abacaxi",  "adicionais", "Abacaxi", "", "5,10", "", "", None),
    ("ad-cream",    "adicionais", "Cream cheese", "", "4,60", "", "", None),
    ("ad-cebola",   "adicionais", "Cebola", "", "4,10", "", "", None),
    ("ad-salada",   "adicionais", "Salada verde", "", "3,30", "", "", None),
    ("ad-bacon",    "adicionais", "Bacon", "", "3,90", "", "", None),

    # ----- salgados -----
    ("sal-brioche",      "salgados", "Brioche de queijo", "", "15,00", "", "", None),
    ("sal-brioche-peru", "salgados", "Brioche de peito de peru com queijo", "", "16,70", "", "", None),
    ("sal-croq-carne",   "salgados", "Croquete de carne", "", "12,90", "", "Famoso da casa", "p-croquete.jpg"),
    ("sal-croq-frango",  "salgados", "Croquete de frango", "", "12,90", "", "", None),
    ("sal-croq-bacal",   "salgados", "Croquete de bacalhau", "", "13,20", "", "", None),
    ("sal-empadas",      "salgados", "Empadas", "Palmito, frango, frango com catupiry, camarão e camarão com catupiry.", "12,50", "", "", None),
    ("sal-pq-trad",      "salgados", "Pão de queijo tradicional", "", "10,00", "", "", None),
    ("sal-pq-rech",      "salgados", "Pão de queijo recheado", "", "12,00", "", "", None),

    # ----- porções -----
    ("por-linguica",  "porcoes", "Linguiça", "Carne, frango ou suína picante.", "62,90", "", "", None),
    ("por-salsicha",  "porcoes", "Salsicha", "Viena ou branca.", "62,90", "", "", None),
    ("por-salsichao", "porcoes", "Salsichão", "Viena ou branco.", "62,90", "", "", None),
    ("por-lingua",    "porcoes", "Língua defumada", "", "68,20", "", "", None),
    ("por-lombinho",  "porcoes", "Lombinho defumado", "", "68,20", "", "", None),
    ("por-lagarto",   "porcoes", "Lagarto defumado", "", "68,20", "", "", "p-defumado.jpg"),
    ("por-lyoner",    "porcoes", "Frios Lyoner", "", "62,90", "", "", "p-lyoner.jpg"),
    ("por-peru",      "porcoes", "Peito de peru defumado", "", "62,90", "", "", None),
    ("por-queijo",    "porcoes", "Queijo", "Minas ou prato.", "30,80", "", "", None),
    ("por-pate",      "porcoes", "Patê", "", "31,00", "", "", None),
    ("por-frango",    "porcoes", "Filé de frango", "", "64,70", "", "", None),
    ("por-mignon",    "porcoes", "Filé mignon", "", "88,40", "", "", None),
    ("por-batata",    "porcoes", "Batata frita", "", "14,20", "", "Cone", None),
    ("por-portuguesa","porcoes", "Batata portuguesa", "", "23,50", "", "", None),
    ("por-salsicha-q","porcoes", "Salsicha com creme de queijo", "", "40,50", "", "", "p-salsicha-queijo.jpg"),
    ("por-pao",       "porcoes", "Pão", "", "7,80", "", "", None),
    ("por-ovos",      "porcoes", "Ovos mexidos simples", "", "13,80", "", "", None),
    ("por-ovos-esp",  "porcoes", "Ovos mexidos especiais", "Com bacon, cebola, tomate e salsa.", "15,70", "", "", None),

    # ----- principais (simples / especial) -----
    ("bov-mignon",   "bovina", "Filé mignon ou crocante", "", "85,00", "100,00", "", None),
    ("bov-parmeg",   "bovina", "Parmegiana de mignon", "", "87,50", "102,50", "", None),
    ("bov-tornedor", "bovina", "Tornedor de mignon", "", "85,00", "100,00", "", None),
    ("bov-lagarto",  "bovina", "Lagarto defumado", "", "54,50", "69,50", "", None),
    ("bov-linguica", "bovina", "Linguiça mista", "", "51,50", "66,50", "", None),
    ("bov-lingua",   "bovina", "Língua defumada", "", "54,50", "69,50", "", None),
    ("bov-costela",  "bovina", "Costela bovina desossada", "", "75,00", "90,00", "", None),

    ("sui-costela",  "suina", "Costela suína", "", "66,00", "81,00", "", None),
    ("sui-mignon",   "suina", "Filé mignon suíno", "", "54,50", "69,50", "", None),
    ("sui-lombinho", "suina", "Lombinho defumado", "", "54,50", "69,50", "", None),
    ("sui-pernil",   "suina", "Pernil assado", "", "54,50", "69,50", "", None),
    ("sui-eisbein",  "suina", "Eisbein", "Joelho de porco defumado, à moda alemã.", "76,90", "91,90", "", None),
    ("sui-kassler",  "suina", "Kassler", "Carré suíno defumado, à moda alemã.", "57,00", "72,00", "", None),
    ("sui-salsichao","suina", "Salsichão", "Viena ou branco.", "51,50", "66,50", "", None),
    ("sui-picante",  "suina", "Linguiça suína picante", "", "51,50", "66,50", "", None),

    ("fra-file",     "frango", "Filé de peito de frango", "", "51,80", "66,80", "", None),
    ("fra-parmeg",   "frango", "Parmegiana de frango", "", "56,60", "71,50", "", None),
    ("fra-crocante", "frango", "Frango crocante", "", "60,00", "75,00", "", None),
    ("fra-linguica", "frango", "Linguiça", "", "51,50", "66,50", "", None),
    ("fra-tiras",    "frango", "Tiras de frango com salada da casa", "", "51,80", "66,80", "", None),

    ("pei-salmao",   "peixes", "Salmão", "", "79,90", "94,90", "", None),
    ("pei-tilapia",  "peixes", "Filé de tilápia", "", "57,80", "72,80", "", None),
    ("pei-omelete",  "peixes", "Omelete de salmão", "Com cream cheese.", "57,80", "72,80", "", None),
    ("pei-camarao",  "peixes", "Camarão catupiry", "Com molho capixaba ou mostarda Dijon.", "85,00", "100,00", "", None),

    # ----- bebidas -----
    ("beb-agua",       "bebidas", "Água sem gás", "", "7,00", "", "500 ml", None),
    ("beb-agua-gas",   "bebidas", "Água com gás", "", "7,50", "", "500 ml", None),
    ("beb-tonica",     "bebidas", "Água tônica", "", "9,50", "", "lata 350 ml", None),
    ("beb-icetea",     "bebidas", "Ice Tea", "", "9,50", "", "garrafa 300 ml", None),
    ("beb-h2oh",       "bebidas", "H2OH!", "", "10,50", "", "garrafa 500 ml", None),
    ("beb-mate",       "bebidas", "Mate Leão", "", "9,50", "", "garrafa 300 ml", None),
    ("beb-crystal",    "bebidas", "Água saborizada Crystal", "", "10,00", "", "maçã e maracujá · 500 ml", None),
    ("beb-green",      "bebidas", "Suco Green People", "", "16,50", "", "diversos sabores · 300 ml", None),
    ("beb-mixfrutt",   "bebidas", "Suco Mixfrutt", "", "16,50", "", "diversos sabores · 300 ml", None),
    ("beb-laranja-3",  "bebidas", "Suco de laranja", "", "12,60", "", "300 ml", None),
    ("beb-laranja-5",  "bebidas", "Suco de laranja", "", "19,00", "", "500 ml", None),
    ("beb-refri",      "bebidas", "Refrigerante", "", "9,50", "", "lata 350 ml", None),
    ("beb-mineirinho", "bebidas", "Mineirinho", "", "9,50", "", "garrafa 350 ml", None),
    ("beb-coco",       "bebidas", "Água de coco", "", "13,00", "", "garrafa 300 ml", None),
    ("beb-guaraviton", "bebidas", "Guaraviton", "", "10,00", "", "500 ml", None),
    ("beb-gatorade",   "bebidas", "Gatorade", "", "13,80", "", "500 ml", None),
    ("beb-redbull",    "bebidas", "Red Bull", "", "18,50", "", "lata 250 ml", None),
    ("beb-shot",       "bebidas", "Shot de limão", "", "4,00", "", "", None),
    ("beb-uva",        "bebidas", "Suco de uva integral", "", "14,00", "", "copo 250 ml", None),

    ("cer-chopp-2",   "cervejas", "Chopp", "", "9,50", "", "200 ml", None),
    ("cer-chopp-3",   "cervejas", "Chopp", "", "12,50", "", "300 ml", None),
    ("cer-chopp-5",   "cervejas", "Chopp", "", "16,80", "", "500 ml", None),
    ("cer-caneca",    "cervejas", "Chopp caneca", "", "13,20", "", "340 ml", None),
    ("cer-bud",       "cervejas", "Budweiser", "", "12,50", "", "long neck 330 ml", None),
    ("cer-stella",    "cervejas", "Stella Artois", "", "13,00", "", "long neck 330 ml", None),
    ("cer-heineken",  "cervejas", "Heineken", "", "13,00", "", "long neck 330 ml", None),
    ("cer-lager",     "cervejas", "Casa do Alemão Lager", "", "22,50", "", "garrafa 500 ml", None),
    ("cer-therezo",   "cervejas", "Therezópolis", "", "12,00", "", "long neck 355 ml", None),

    # ----- café -----
    ("caf-60",         "cafe", "Café", "", "", "", "60 ml", None),
    ("caf-120",        "cafe", "Café", "", "8,90", "", "120 ml", None),
    ("caf-leite",      "cafe", "Café com leite", "", "", "", "120 ml", None),
    ("caf-expresso",   "cafe", "Café expresso", "", "", "", "60 ml", None),
    ("caf-duplo",      "cafe", "Café expresso duplo", "", "16,90", "", "120 ml", None),
    ("caf-longo",      "cafe", "Café expresso longo", "", "14,00", "", "120 ml", None),
    ("caf-exp-leite",  "cafe", "Café expresso com leite", "", "12,90", "", "120 ml", None),
    ("caf-cappuccino", "cafe", "Cappuccino", "", "15,20", "", "120 ml", None),
    ("caf-choc-60",    "cafe", "Chocolate quente", "", "10,20", "", "60 ml", None),
    ("caf-choc-120",   "cafe", "Chocolate quente", "", "15,90", "", "120 ml", None),
    ("caf-frozen",     "cafe", "Frozen", "Chocolate, cappuccino ou avelã.", "23,50", "", "", None),
    ("caf-cha",        "cafe", "Chás diversos", "", "8,30", "", "120 ml", None),
    ("caf-chantilly",  "cafe", "Porção de chantilly", "", "5,80", "", "", None),
    ("caf-pao",        "cafe", "Pão com manteiga", "", "6,50", "", "", None),
    ("caf-integral",   "cafe", "Torrada integral", "", "7,30", "", "", None),
    ("caf-petro-1",    "cafe", "Torrada Petrópolis", "", "8,50", "", "1 fatia", "p-torrada.jpg"),
    ("caf-petro-2",    "cafe", "Torrada Petrópolis", "", "14,90", "", "2 fatias", None),
    ("caf-petro-q",    "cafe", "Torrada Petrópolis com queijo", "", "25,30", "", "2 fatias", None),
    ("caf-frappu",     "cafe", "Frappuccino gelado do Starbucks", "", "18,00", "", "280 ml", None),
    ("caf-affogato",   "cafe", "Café affogato", "Nespresso, sorvete de chocolate ou creme, calda.", "18,90", "", "", None),
    ("caf-banoffee",   "cafe", "Café banoffee", "Nespresso, doce de leite, chantilly, banana, canela em pó.", "18,90", "", "", None),
    ("caf-macchiato",  "cafe", "Café ice macchiato", "Nespresso, sorvete de milho verde ou queijo.", "18,90", "", "", None),

    # ----- sorvetes -----
    ("sor-1",    "sorvetes", "Taça", "", "15,20", "", "1 bola", None),
    ("sor-2",    "sorvetes", "Taça", "", "23,50", "", "2 bolas", None),
    ("sor-3",    "sorvetes", "Taça", "", "31,80", "", "3 bolas", None),
    ("sor-mk-3", "sorvetes", "Milkshake", "", "31,50", "", "300 ml", None),
    ("sor-mk-5", "sorvetes", "Milkshake", "", "38,50", "", "500 ml", None),

    # ----- doces -----
    ("doc-quindim",     "doces", "Quindim", "", "15,30", "", "unidade", "p-quindim.jpg"),
    ("doc-strudel",     "doces", "Apfelstrudel", "Strudel de maçã.", "18,90", "", "fatia", None),
    ("doc-bomba-choc",  "doces", "Bomba de chocolate", "", "18,90", "", "unidade", "p-bomba.jpg"),
    ("doc-bomba-creme", "doces", "Bomba de creme", "", "18,90", "", "unidade", None),
    ("doc-alema",       "doces", "Torta alemã", "", "18,90", "", "fatia", None),
    ("doc-floresta",    "doces", "Torta floresta negra", "", "18,90", "", "fatia", None),
    ("doc-coco",        "doces", "Torta de coco", "", "18,90", "", "fatia", None),
    ("doc-chocolate",   "doces", "Torta de chocolate", "Com amendoim.", "18,90", "", "fatia", None),
    ("doc-limao",       "doces", "Torta de limão", "", "18,90", "", "fatia", None),
    ("doc-alema-ddl",   "doces", "Torta alemã de doce de leite", "", "24,30", "", "fatia", None),
    ("doc-palha",       "doces", "Torta de palha italiana", "", "24,30", "", "fatia", None),
    ("doc-brigadeiro",  "doces", "Torta de brigadeiro", "Com raspas de chocolate.", "24,30", "", "fatia", None),
    ("doc-milfolhas",   "doces", "Mil folhas", "Creme ou doce de leite.", "19,90", "", "fatia", "p-milfolhas.jpg"),
    ("doc-rocambole",   "doces", "Rocambole de rum", "", "18,90", "", "fatia", None),
    ("doc-redvelvet",   "doces", "Red velvet", "", "24,30", "", "fatia", None),
    ("doc-banoffee",    "doces", "Mini banoffee zero", "", "26,00", "", "", None),
    ("doc-ricota",      "doces", "Torta de ricota diet", "", "19,90", "", "fatia", None),
    ("doc-choc-diet",   "doces", "Torta de chocolate diet", "", "19,90", "", "fatia", None),
    ("doc-belga",       "doces", "Bolo de brigadeiro belga", "Com avelãs. Zero açúcar e zero lactose.", "24,30", "", "fatia", None),
    ("doc-cheese-fv",   "doces", "Cheesecake de frutas vermelhas", "", "24,30", "", "fatia", None),
    ("doc-cheese-pis",  "doces", "Cheesecake de pistache", "", "26,30", "", "fatia", None),
    ("doc-choconata",   "doces", "Choconata", "", "23,30", "", "fatia", None),
    ("doc-tiramisu",    "doces", "Tiramisù", "", "25,30", "", "fatia", None),
    ("doc-tartelete",   "doces", "Tartelete de limão", "", "20,30", "", "", None),
    ("doc-brownie",     "doces", "Brownie com nozes", "", "18,30", "", "", None),
    ("doc-morango",     "doces", "Morango crock", "", "24,30", "", "fatia", None),
    ("doc-nata",        "doces", "Pastel de nata", "", "16,80", "", "", None),
]

# Lojas da rede, do site oficial (casadoalemao.com.br, "Lojas").
# (id, nome, endereço, telefone, iFood)
LOJAS = [
    ("quitandinha", "Petrópolis · Quitandinha", "Av. Ayrton Senna, 927 · Quitandinha · Petrópolis - RJ", "(24) 2291-4291", ""),
    ("centro", "Petrópolis · Centro", "Rua 16 de Março, 138 · Centro · Petrópolis - RJ", "(24) 3616-2088",
     "https://www.ifood.com.br/delivery/petropolis-rj/casa-do-alemao-centro-centro/b2d1230d-0a9b-44e4-89db-7e931d5e68df"),
    ("itaipava", "Petrópolis · Itaipava", "Estrada União e Indústria, 9500, lojas 1 a 3 · Itaipava · Petrópolis - RJ", "(24) 99305-2522",
     "https://www.ifood.com.br/delivery/petropolis-rj/casa-do-alemao-itaipava-itaipava/24ba39bc-2a56-4ddb-868f-1b648cca8660"),
    ("br040-subida", "BR-040 · Subida (sentido Petrópolis)", "Rodovia Washington Luiz, km 13 · Duque de Caxias - RJ", "(21) 2676-1292", ""),
    ("br040-descida", "BR-040 · Descida (sentido Rio)", "Rodovia Washington Luiz, km 13 · Duque de Caxias - RJ", "(21) 2676-1499", ""),
    ("barra", "Barra da Tijuca", "Av. das Américas, 1699 · Barra da Tijuca · Rio de Janeiro - RJ", "(21) 2497-2629",
     "https://www.ifood.com.br/delivery/rio-de-janeiro-rj/casa-do-alemao-barra-da-tijuca/93538c48-4dcd-4020-b0d7-b2b5d08add1e"),
    ("dutra-meriti", "Dutra · São João de Meriti (sentido São Paulo)", "Rodovia Presidente Dutra, km 6 · São João de Meriti - RJ", "(21) 2751-1294",
     "https://www.ifood.com.br/delivery/sao-joao-de-meriti-rj/casa-do-alemao-jardim-meriti/f9029d9f-eaf1-4d03-8e88-93cd60259a0d"),
    ("itaborai", "BR-101 · Itaboraí (sentido Região dos Lagos)", "Rodovia BR-101, km 284, Posto Amigo de Itaboraí · Itaboraí - RJ", "(21) 3637-2423", ""),
    ("tangua", "BR-101 · Tanguá (sentido Rio)", "Rodovia BR-101, km 276,6, Posto Retiro dos Bandeirantes · Tanguá - RJ", "(21) 96628-6954", ""),
]

HISTORIA = (
    "Tudo começou em 1945, em Petrópolis, na Panificação Quitandinha, famosa pelos biscoitos amanteigados. "
    "Com a chegada do casal Stephan e Julka Kern vieram os doces e os embutidos — e o Sr. Stephan, no balcão, "
    "conversando com os clientes com seu sotaque carregado e oferecendo provas dos produtos.\n\n"
    "\"Vamos parar na casa daquele alemão\", diziam. O nome pegou. Mais de 75 anos depois, as receitas continuam "
    "as mesmas: fabricação própria e artesanal, com ingredientes selecionados."
)


def main():
    ids = [i[0] for i in ITENS]
    assert len(ids) == len(set(ids)), "id repetido em ITENS"
    secoes_ok = {s[0] for s in SECOES}
    assert all(i[1] in secoes_ok for i in ITENS), "item em seção que não existe"

    secoes = []
    for i, nome, aba, sobre, estilo, nota, extras in SECOES:
        s = {"id": i, "nome": nome, "sobre": sobre, "estilo": estilo, "nota": nota}
        if aba: s["aba"] = aba
        s.update(extras)
        secoes.append(s)

    semente = {
        "restaurante": "casadoalemao",
        "site": {
            "nome": "Casa do Alemão",
            "chamada": "Croquete, pão com linguiça, salsicharia própria e os doces da confeitaria. Pare, sente e aproveite.",
            "url": URL_PUBLICA,
            "whatsapp": "", "instagram": "casadoalemaooficial", "endereco": "", "horario": "",
            "historia": HISTORIA,
        },
        "secoes": secoes,
        "lojas": [{"id": i, "nome": n, "endereco": e, "telefone": tel, "ifood": f, "ordem": k}
                  for k, (i, n, e, tel, f) in enumerate(LOJAS)],
        "itens": [{"id": i, "secao": s, "nome": n, "desc": d, "preco": p, "preco2": p2, "tag": t,
                   "foto": foto(f) if f else "", "esgotado": False}
                  for i, s, n, d, p, p2, t, f in ITENS],
    }
    texto = "// Gerado por gerar_semente.py. Nao edite a mao.\nwindow.SEMENTE = " + \
            json.dumps(semente, ensure_ascii=False) + ";\n"
    saida = os.path.join(BASE, "semente.js")
    io.open(saida, "w", encoding="utf-8").write(texto)
    maior = max(len(json.dumps(i)) for i in semente["itens"])
    sem_preco = [f"{i['nome']} ({i['tag']})" for i in semente["itens"] if not i["preco"]]
    print(f"semente.js {os.path.getsize(saida)//1024} KB | {len(secoes)} seções | {len(semente['itens'])} itens | {len(LOJAS)} lojas | "
          f"{sum(1 for i in semente['itens'] if i['foto'])} com foto | maior item {maior//1024} KB")
    if sem_preco: print("Sem preço (conferir no cardápio):", ", ".join(sem_preco))


if __name__ == "__main__":
    main()
