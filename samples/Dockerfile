FROM node:14
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 80
EXPOSE 8066
CMD [ "node", "app.js" ]
