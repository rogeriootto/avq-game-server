// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebSocket = require('ws');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = require('axios');

const axiosClient = axios.create({
  baseURL: 'http://localhost:3000',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    Authorization:
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoicm9nZXJpbyIsInN1YiI6MSwiaWF0IjoxNzM2MzY4MjU4LCJleHAiOjE3Njc5MDQyNTh9.OxLdJ73qmAvfxlYSUjk7zlwS-IEmPutY9h84q9ckQdY',
  },
});

const PORT = 8080;
let timer = null;

const users = [];
let usersStillConnected = [];

let songs = [];
let options = [];
let guesses = [];

// Cria o servidor WebSocket
const wss = new WebSocket.Server({ port: PORT });
console.log(`Server started on port ${PORT}`);

wss.on('connection', (ws) => {
  console.log('A new client connected!');
  ws.send(
    JSON.stringify({
      type: 'welcome',
      message: 'Welcome',
    }),
  );

  // Escuta mensagens do cliente
  ws.on('message', async (data) => {
    try {
      const parsedData = JSON.parse(data); // Converte a string JSON em um objeto

      // Broadcast da mensagem para todos os clientes conectados
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });

      let type = parsedData.type;
      switch (type) {
        case 'join':
          const { user, authToken } = parsedData.message;
          console.log('Trying to join...');
          const exists = users.some(
            (arrUser) =>
              arrUser.user === user && arrUser.authToken === authToken,
          );
          if (!exists) {
            users.push({ user, score: 0 });
            console.log(`User ${user} joined the game!`);
          } else {
            console.log('User already joined');
          }
          break;
        case 'start':
          startTimer(30, wss, WebSocket);
          break;
        case 'loadSongs':
          await getAllSongs();
          break;
        case 'sendNextVideo':
          await getAllSongs();
          sendNextVideo(wss, WebSocket);
          startTimer(30, wss, WebSocket);
          break;
        case 'guess':
          if (parsedData.guess) {
            guesses.push({ user: parsedData.user, guess: parsedData.guess });
          }
          console.log('Guesses:', guesses);
          break;
        case 'playerStatus':
          if (parsedData.user) {
            if (!usersStillConnected.includes(parsedData.user)) {
              usersStillConnected.push(parsedData.user.name);
              console.log('Added user to the list');
            }
          }
          break;
        case 'seeUsers':
          console.log('Users:', users);
          break;
        case 'seeSongs':
          console.log('Songs:', songs);
          break;
        case 'debugOptions':
          generateOptions(songs[0]);
          break;
        default:
          console.log('Tipo de mensagem não reconhecido:', parsedData.type);
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);

      // Envia um erro ao cliente
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Mensagem inválida. Certifique-se de enviar JSON válido.',
        }),
      );
    }
  });

  ws.on('close', () => {
    console.log('A client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

async function sendNextVideo(wss, WebSocket) {
  if (songs.length === 0) {
    console.log('No more songs to play');
    return;
  }
  const selectedSong = songs[songs.length - 1];
  songs.pop();
  await generateOptions(selectedSong);
  guesses = [];

  // console.log('Sending to client:', {
  //   type: 'url',
  //   url: selectedSong.link,
  //   options: options,
  //   whoAdded: selectedSong.whoAdded,
  // });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: 'url',
          url: selectedSong.link,
          options: options,
          whoAdded: selectedSong.whoAdded,
        }),
      );
    }
  });
  startTimer(30, wss, WebSocket, selectedSong);
}

const startTimer = (timeLeft, wss, WebSocket, selectedSong) => {
  if (timer) clearInterval(timer); // Reinicia o timer, se já existir
  sendPlayersToFrontEnd();

  timer = setInterval(() => {
    if (timeLeft >= 0) {
      // console.log(`Time left: ${timeLeft}`);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'timer', time: timeLeft }));
        }
      });
      timeLeft--;
    } else {
      clearInterval(timer);
      console.log('Timer ended, revealing answers');
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'reveal', reveal: true }));
        }
      });
      responseTimer(20, wss, WebSocket, selectedSong);
    }
  }, 1000);
};

const responseTimer = (timeLeft, wss, WebSocket, selectedSong) => {
  if (timer) clearInterval(timer);
  seeIfUserGuessedRight(selectedSong);
  sendPlayersToFrontEnd();
  timer = setInterval(() => {
    if (timeLeft >= 0) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'timer', time: timeLeft }));
        }
      });
      timeLeft--;
    } else {
      clearInterval(timer);
      console.log('Timer ended');
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'reveal', reveal: false }));
        }
      });
      checkIfPlayersAreStillOnGame();
      sendNextVideo(wss, WebSocket);
    }
  }, 1000);
};

function sendPlayersToFrontEnd() {
  console.log('Sending players to front end, users:', users);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'players', players: users }));
    }
  });
}

function checkIfPlayersAreStillOnGame() {
  users.forEach((user, index) => {
    if (!usersStillConnected.includes(user.user)) {
      console.log(user.user, 'is still connected');
      users.splice(index, 1);
    }
  });
  usersStillConnected = [];
}

async function getAllSongs() {
  await axiosClient
    .get('/song/all')
    .then((response) => {
      songs = response.data;
      songs.sort(() => Math.random() - 0.5);
      console.log('Songs are loaded and ready to play');
    })
    .catch((error) => {
      console.error('Error getting songs:', error);
    });
}

async function generateOptions(selectedSong) {
  if (!selectedSong) {
    return;
  }
  // console.log('Generating options... to song:', selectedSong.name);

  const categorySelected =
    selectedSong.categories[
      Math.floor(Math.random() * selectedSong.categories.length)
    ];
  // console.log('Selected song id:', selectedSong.id);
  // console.log('Selected category:', categorySelected.category.name);
  await axiosClient
    .get(
      `/category/${categorySelected.category.name}/random/${selectedSong.id}`,
    )
    .then((response) => {
      options = response.data;
      options.push(selectedSong.name);
      options.sort(() => Math.random() - 0.5);
      return;
    })
    .catch((error) => {
      console.error('Error getting options:', error);
    });
}

function seeIfUserGuessedRight(selectedSong) {
  guesses.forEach((guess) => {
    if (guess.guess === selectedSong.name) {
      users.forEach((user) => {
        if (user.user === guess.user) {
          user.score += 1;
        }
      });
    }
  });
}
