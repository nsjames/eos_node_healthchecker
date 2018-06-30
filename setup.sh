#!/bin/bash

cd ~
curl -sL https://deb.nodesource.com/setup_8.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt-get install nodejs -y
sudo apt-get install build-essential -y
sudo apt-get install git -y
git clone https://github.com/nsjames/eos_node_healthchecker.git