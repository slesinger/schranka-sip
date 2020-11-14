require('dotenv').config()
const ariClient = require('ari-client')
const dgram = require('dgram')
const server = dgram.createSocket('udp4')
const mqtt = require('mqtt')
const provider = require('./google-speech-provider')

const ariApp = 'schranka'

class AriController {
  channels = []

  constructor(options) {
    this.options = Object.assign({}, options)
    this.connect()

    process.on('SIGINT', async () => {
      await this.close();
      process.exit(0);
    });
  }

  async connect() {
    this.ari = await ariClient.connect(process.env.AST_HOST, process.env.AST_USER, process.env.AST_PASS)
    this.ari.once('StasisStart', channelJoined)

    function channelJoined(event, incoming) {
      console.log("Someone is ringing the bell")
      incoming.answer()
    }

    this.ari.start(ariApp)
  }

  async close() {
    if (this.closing) {
      return
    }
    this.closing = true

    this.client.close()  // Stop UDP client that forwards audio to dynamic extMedia port
    delete this.client
    this.speechProvider.stopStream()

    for (var i = 0; i < this.channels.length; i++) {
      if (this.channels[i]) {
        console.log("Hanging up channel", this.channels[i].id)
        try {
          await this.channels[i].hangup()
        } catch (error) {
        }
        delete this.channels[i]
      }
    }
    this.channels = []

    if (this.extChannel) {
      console.log("Hanging up external media channel")
      try {
        await this.extChannel.hangup()
      } catch (error) {
        console.log("Ext media ch hangup", error)
      }
      delete this.extChannel
    }

    if (this.bridge) {
      console.log("Destroying bridge", this.bridge.id)
      try {
        await this.bridge.destroy()
      } catch (error) {
      }
      delete this.bridge
    }
  }

  async zazvon() {
    // Create bridge
    this.bridge = this.ari.Bridge()
    try {
      await this.bridge.create({ type: "mixing" })
    } catch (error) {
      console.error(error)
      this.close()
    }
    this.bridge.on('BridgeDestroyed', (event) => {
      this.close()
    })

    this.options.dialstring.forEach(element => {
      this.originate(element)
    })
    // Now we create the External Media channel for microphone and speaker
    this.extChannel = this.ari.Channel()
    this.extChannel.on('StasisStart', (event, chan) => {
      chan.getChannelVar({
        channelId: chan.id,
        variable: "UNICASTRTP_LOCAL_PORT"
      }).then((port) => {
        this.extMediaMicPort = parseInt(port.value)
        this.client = dgram.createSocket('udp4')

        server.on('message', (msg, rinfo) => {
          if (this.client !== undefined) {
            this.client.send(msg, 0, msg.length, this.extMediaMicPort, process.env.THIS_HOST)
            if (this.speechProvider !== undefined) {
              // Strip the 12 byte RTP header
              this.speechProvider.audioInputStreamTransform.write(msg.slice(12))
            }
          }
        })

      })
      this.bridge.addChannel({ channel: chan.id })
    })
    this.extChannel.on('StasisEnd', (event, chan) => {
      this.close()
    })

    try {
      let resp = await this.extChannel.externalMedia({
        app: ariApp,
        external_host: this.options.externalHost,
        connection_type: "server",
        format: "ulaw",
        direction: "both"
      })
    } catch (error) {
      console.log(error)
      this.close()
    }

    delete this.closing

    this.botStart()
  }

  async originate(dialString) {
    var ch = this.ari.Channel()
    this.channels.push(ch)
    ch.on('StasisStart', (event, chan) => {
      console.log("Adding", dialString, "to bridge")
      this.bridge.addChannel({ channel: chan.id })
      this.botCancel()
    })
    ch.on('StasisEnd', (event, chan) => {
      this.close()
    })
    try {
      await ch.originate({
        endpoint: dialString,
        formats: 'ulaw',
        app: ariApp,
        callerId: process.env.CALLER_ID
      })
    } catch (error) {
      this.close()
    }
  }


  transcriptCallback(text, isFinal) {
    if (isFinal) {
      //console.log(text)
    }
  }

  resultsCallback(results) {
    if (results[0].isFinal) {
      const transcription = results
        .map(result => result.alternatives[0].transcript)
        .join('\n')
      console.log(`Transcription: ${transcription}`)
      const wordsInfo = results[0].alternatives[0].words
      wordsInfo.forEach(a =>
        console.log(` word: ${a.word}, speakerTag: ${a.speakerTag}`)
      )
    }
  }

  async speechProviderStart() {
    console.log("Starting speech provider")
    let config = {
      encoding: "MULAW",
      sampleRateHertz: 8000,
      languageCode: process.env.STT_LANG,
      audioChannelCount: 1,
      model: "default",
      profanityFilter: false,
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true,
      metadata: {
        interactionType: 'DISCUSSION',
        microphoneDistance: 'MIDFIELD',
        originalMediaType: 'AUDIO',
        recordingDeviceName: 'ConferenceCall',
      }
    }

    // Start the speech provider passing in the audio server socket.
    this.speechProvider = new provider.GoogleSpeechProvider(config,
      (text, isFinal) => {
        this.transcriptCallback(text, isFinal)
      },
      (results) => {
        //this.resultsCallback(results)
      },
    )
  }

  async botStart() {

    this.ari.bridges.play({ bridgeId: this.bridge.id, media: 'sound:zvonek-odezva' })
      .then(playback => {
        this.playbackId = playback.id
      })
      .catch(err => console.log(err))
    this.speechProviderStart()

    //TODO docasne, at to closne bot
    setTimeout(() => {
      this.close()
    }, 180000)

  }

  async botCancel() {
    this.botStopPlayback()
  }

  async botStopPlayback() {
    // Stop any ongoig playbacks
    if (this.playbackId !== null) {
      this.ari.playbacks.stop({
        playbackId: this.playbackId
      })
        .then(() => {
          // console.log("stop OK")
        })
        .catch(err => {
          console.log("stop Err", err)

        })
      this.playbackId = null
    }
  }
}

/*
externalHost: Host and port where to send UPD for speaker. Listen port for microphone is autogenerated.
*/
var ariController = new AriController({
  dialstring: JSON.parse(process.env.RING_TO_JSON),
  externalHost: process.env.SPEAKER_UDP_HOST_PORT,
})


//Listen for UDP packets from mic
server.on('error', (err) => {
  console.log(`server error:\n${err.stack}`)
  server.close();
})
server.on('listening', () => {
  const address = server.address()
  console.log(`UDP server listening ${address.address}:${address.port}`)
})
server.bind(parseInt(process.env.MIC_STATIC_UDP_PORT))

var mqClient = mqtt.connect(process.env.MQTT_HOST, { username: process.env.MQTT_USER, password: process.env.MQTT_PASS })
mqClient.on('connect', function () {
  mqClient.subscribe(process.env.MQTT_TOPIC, function (err) {
    if (!err) {
      console.log("Subscribed to", process.env.MQTT_TOPIC, "MQTT topic")
    }
    else {
      console.log("MQTT error", err)
    }
  })
})

mqClient.on('message', function (topic, message) {
  // message is Buffer
  var msg = message.toString()
  console.log('schranka/zvonek', msg)
  if (msg === 'on' && ariController.bridge === undefined) {
    ariController.zazvon()
  }
})
