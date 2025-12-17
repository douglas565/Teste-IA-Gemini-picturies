LumiScan Offline AI 💡🤖
<div align="center"> <img src="https://github.com/user-attachments/assets/e7bbb6a3-abb9-4ad5-b6c7-f7758785743f" alt="LumiScan Banner" width="300" />


<em>Sistema Inteligente de Reconhecimento de Luminárias (IP) - 100% Offline</em> </div>

📖 Sobre o Projeto
O LumiScan Offline é uma aplicação Desktop desenvolvida para automatizar o inventário de iluminação pública. O sistema analisa imagens de luminárias (postes) para identificar automaticamente o Modelo (ex: Pallas, Kingsun) e a Potência (Watts), eliminando a necessidade de digitação manual e análise visual cansativa.

Diferente de soluções em nuvem, o LumiScan foi projetado para rodar localmente no computador do usuário, garantindo privacidade e funcionamento sem internet, utilizando uma combinação híbrida de OCR Clássico (Tesseract) e Visão Computacional via LLM Local (Ollama/LLaVA).

✨ Funcionalidades Principais
🚀 Processamento em Lote: Arraste pastas inteiras para processar centenas de imagens de uma vez.

🧠 IA Híbrida Local:

Heurística: Algoritmos matemáticos de visão para detecção de bordas e OCR (Tesseract.js).

IA Generativa (Opcional): Integração com Ollama (modelo LLaVA/Llama) para "tira-teima" e análise contextual visual.

👁️ Visão Computacional Avançada:

Filtros automáticos: Negativo, Binarização, Nitidez e Recorte Inteligente da cabeça da luminária.

Detecção de "ruído" (céu, árvores, chão) para evitar falsos positivos.

🎓 Aprendizado Contínuo (Few-Shot Learning):

Quando você corrige um erro manualmente, o sistema salva a "assinatura visual" daquela luminária.

Futuras imagens similares são reconhecidas automaticamente com base nas suas correções anteriores (armazenamento local).

🔒 100% Offline: Nenhum dado é enviado para a nuvem.

🛠️ Tecnologias Utilizadas
Core: Electron + React + TypeScript

Build Tool: Vite

OCR Engine: Tesseract.js (WASM)

IA Local: Integração via API REST com Ollama

Estilização: Tailwind CSS

Armazenamento: LocalStorage (para base de conhecimento do usuário)

⚙️ Pré-requisitos
Antes de começar, certifique-se de ter instalado:

Node.js (Versão 18 ou superior)

(Opcional, para IA Avançada) Ollama instalado e rodando.

Recomendado baixar o modelo de visão:

Bash

ollama run llava
🚀 Como Rodar o Projeto
Clone o repositório

Bash

git clone https://github.com/seu-usuario/lumiscan-offline.git
cd lumiscan-offline
Instale as dependências

Bash

npm install
Inicie em Modo de Desenvolvimento Isso abrirá a janela do Electron com Hot-Reload ativado.

Bash

npm run electron:dev
Gerar Executável (Build) Para criar o instalador .exe (Windows) ou executável nativo do seu sistema:

Bash

npm run build:exe
O arquivo será gerado na pasta dist/ ou release/.

🧠 Como Funciona o Reconhecimento?
O sistema utiliza um pipeline de decisão em 6 etapas (services/ocrService.ts):

Pré-processamento: A imagem é limpa via Canvas API (recorte, contraste).

Filtro de Viabilidade (IA): O Ollama verifica se a imagem é realmente uma luminária (e não uma foto do chão ou rua).

Memória Visual: O sistema busca no banco de dados local se já viu uma imagem visualmente idêntica (cor, formato, textura).

OCR Heurístico: O Tesseract lê todo texto possível na imagem (normal e invertida).

Análise Semântica (IA): O texto lido e a imagem são enviados para o Ollama, que decide qual é o Modelo e a Potência com base em regras de engenharia e contexto visual.

Fusão: O sistema pondera a confiança de cada etapa e entrega o resultado final (Verificado, Pendente ou Desconhecido).

📂 Estrutura do Projeto
Plaintext

/
├── public/              # Ícones e assets estáticos
├── src/
│   ├── components/      # Componentes React (Cards, Modais)
│   ├── services/        # Lógica de IA e Processamento
│   │   ├── ocrService.ts    # Pipeline principal e Visão Computacional
│   │   ├── ollamaService.ts # Integração com LLM Local
│   │   └── geminiService.ts # (Legado/Opcional) Integração Google AI
│   ├── types.ts         # Definições de Tipos TypeScript
│   ├── App.tsx          # Interface Principal
│   └── main.tsx         # Ponto de entrada React
├── electron.js          # Processo Principal do Electron
├── vite.config.ts       # Configuração do Vite
└── package.json         # Scripts e Dependências
📝 Licença
Este projeto está sob a licença MIT. Sinta-se à vontade para usar, modificar e distribuir.

Desenvolvido por LumiScan Team
