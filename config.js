// Configuração do cardápio.
//
// O bloco `firebase` vem do console (Configurações do projeto > Seus apps > app
// web). Ele NÃO é segredo: identifica o projeto, e qualquer site que use o
// Firebase o expõe assim. Quem protege os dados são as regras do Firestore
// (firestore.rules), conferidas no servidor.
window.CARDAPIO_CONFIG = {
  restaurante: "casadoalemao",
  // Instagram do Cardápio à Mesa, embaixo da assinatura no rodapé ("" esconde).
  assinatura: { instagram: "" },
  // UID do administrador do Cardápio à Mesa. Não é segredo: é o mesmo código
  // que está nas regras do Firestore, e serve só para o painel mostrar a
  // liberação do pedido na mesa. Quem decide de verdade são as regras.
  admin: "ziGoA3CYfjSFGbVzU8KzPtK4ND03",
  firebase: {
    apiKey: "AIzaSyCO4jXgsyp990Q-2JvI8Aw-zBn9le7oPL0",
    authDomain: "cardapio-a-mesa.firebaseapp.com",
    projectId: "cardapio-a-mesa",
    storageBucket: "cardapio-a-mesa.firebasestorage.app",
    messagingSenderId: "589264581265",
    appId: "1:589264581265:web:49e706338d78a1aff28530"
  }
};
