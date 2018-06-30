#!/bin/bash

node health.js
sudo nginx -t && sudo service nginx reload