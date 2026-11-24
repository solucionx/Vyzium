# Vyzium 3.5.8

Corrige a exibição do primeiro QR no painel do WhatsApp quando a página oficial de login apresenta o código antes de carregar o módulo interno de conexão. O painel acompanha a renovação e retira a imagem quando o código desaparece. O fluxo de autenticação continua a cargo do WhatsApp.

O build confere o cliente WhatsApp e o controlador da sessão dentro do aplicativo Windows. O teste externo tenta decodificar o QR em um perfil temporário e registra o resultado no Actions. Para validar o uso com uma conta, escanear com um telefone, confirmar o estado Conectado e reabrir o Vyzium para verificar a persistência da sessão.
