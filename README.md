# Intercom for Schranka
SIP solution. When ring button is pressed, MQTT message triggers ARI application. All registered phones start to ring. All are added in to brindge can talk to each other including Schranka via Asterisk external media and ffmpeg.

# Docker
docker build -t schranka-sip .

docker run -d --name schranka-sip --p 5001:5001/udp schranka-sip

# TODO
[x] configuration and password in template
[x] containerize
[x] Mqtt trigger
[x] Microphone hw
[x] Pipe RTP from generated port from microphone
[x] Shutdown bridge and all after 5 minutes, hangup
[ ] Test ffplay volume amplification. Does not work yet
[ ] Video support
[ ] volat pres internet
[ ] Bot IVR voice bot
[ ] za jak dlouho jede nejblizsi autobus
