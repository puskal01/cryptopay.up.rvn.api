# syntax=docker/dockerfile:1

FROM node:16.13
ENV NODE_ENV=production

WORKDIR ./

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .

EXPOSE 1360
CMD [ "npm", "start" ]
