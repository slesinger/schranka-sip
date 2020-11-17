FROM node:12
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install
COPY . .
COPY google.json /usr/src/app/google.json
EXPOSE 5001/udp
CMD [ "node", "app.js" ]
