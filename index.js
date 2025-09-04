const express = require('express');
const axios = require('axios');

const app = express();
const port = 3000;

// --- Configuration ---
const DEFAULT_FROM_PROVINCE_ID = '2'; // e.g., 2 for Hà Nội
const DEFAULT_TO_PROVINCE_ID = '1'; // e.g., 1 for Nghệ An
const BEAUTIFUL_SEATS = ['A1', 'A2', 'A3', 'A4', 'E1', 'E2', 'E3', 'E4', 'C1', 'C2', 'C3', 'C4'];
// -------------------

const getAvailableBeautifulSeats = async (bus, departDate, fromProvinceId, toProvinceId) => {
  const url = 'https://api-pro.xeca.vn/v1/bus-time-exts/detail-bus-time';
  const params = {
    _source: 'wb',
    _client_id: '31f5a73d-1677-4884-bd6b-38cedf0ca693',
    depart_date: departDate,
    bus_time_id: bus.id,
    bus_hop_id: bus.bus_hop_id,
    bus_stage_id: bus.bus_stage_id,
    from_province_id: fromProvinceId,
    to_province_id: toProvinceId,
  };
  const headers = {
    'Pragma': 'no-cache',
    'Accept': '*/*',
    'Sec-Fetch-Site': 'same-site',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Mode': 'cors',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://vanminh.xeca.vn',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    'Referer': 'https://vanminh.xeca.vn/',
    'Sec-Fetch-Dest': 'empty',
    'x-bus-agency-id': '1',
    'Priority': 'u=3, i',
  };

  try {
    const response = await axios.get(url, { params, headers });
    const seatMap = response.data?.data?.seatMap;

    if (!seatMap) {
      return [];
    }

    const availableSeats = [];
    seatMap.objArea.forEach(area => {
      area.objRow.forEach(row => {
        row.objSeat.forEach(seat => {
          if (seat.seatStatus === 'empty' && BEAUTIFUL_SEATS.includes(seat.seatDisplayName)) {
            availableSeats.push(seat.seatDisplayName);
          }
        });
      });
    });
    return availableSeats;
  } catch (error) {
    console.error(`[${departDate}] Error fetching seat details for bus ${bus.id}:`, error.message);
    return [];
  }
};

const findBusTickets = async (departDate, fromProvinceId, toProvinceId) => {
  const url = 'https://api-pro.xeca.vn/v1/bus-times';
  const params = {
    _source: 'wb',
    _client_id: '31f5a73d-1677-4884-bd6b-38cedf0ca693',
    departDate: departDate,
    fromProvinceId: fromProvinceId,
    toProvinceId: toProvinceId,
    sourceChannel: '11',
  };

  const headers = {
    'Pragma': 'no-cache',
    'Accept': '*/*',
    'Sec-Fetch-Site': 'same-site',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Mode': 'cors',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://vanminh.xeca.vn',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    'Referer': 'https://vanminh.xeca.vn/',
    'Sec-Fetch-Dest': 'empty',
    'x-bus-agency-id': '1',
    'Priority': 'u=3, i',
  };

  try {
    const response = await axios.get(url, { params, headers });

    if (response.status === 200 && response.data && response.data.data && response.data.data.busTimes) {
      return response.data.data.busTimes
        .filter(bus => parseInt(bus.empty_seat, 10) > 0)
        .map(bus => {
          const year = departDate.substring(0, 4);
          const month = departDate.substring(4, 6);
          const day = departDate.substring(6, 8);
          const formattedDate = `${day}/${month}/${year}`;

          return {
            id: bus.id,
            bus_hop_id: bus.bus_hop_id,
            bus_stage_id: bus.bus_stage_id,
            date: formattedDate,
            start_time: bus.start_time,
            time: `${bus.start_time} - ${bus.end_time}`,
            bus_no: bus.bus_no || 'N/A',
            empty_seat: parseInt(bus.empty_seat, 10),
            price: bus.price,
            total_seat: bus.total_seat,
            start_address: bus.start_station_name,
            end_address: bus.finish_station_name,
            route_name: bus.route_name
          };
        });
    } else {
      console.error(`[${departDate}] Failed to fetch bus times or unexpected response format.`);
      return [];
    }
  } catch (error) {
    console.error(`[${departDate}] An error occurred while fetching bus tickets:`, error.message);
    return [];
  }
};

app.get('/tickets', async (req, res) => {
    const { date, startTime, endTime, from, to } = req.query; // Expects YYYYMMDD and optional HH:mm format

    if (!date) {
        return res.status(400).json({ error: 'Please provide a date in YYYYMMDD format.' });
    }

    const fromProvinceId = from || DEFAULT_FROM_PROVINCE_ID;
    const toProvinceId = to || DEFAULT_TO_PROVINCE_ID;

    try {
        // 1. Fetch bus list for the single date
        console.log(`Fetching tickets for ${date} from ${fromProvinceId} to ${toProvinceId}...`);
        let allBuses = await findBusTickets(date, fromProvinceId, toProvinceId);

        // 2. Filter buses by time window
        if (startTime && endTime) {
            allBuses = allBuses.filter(ticket => ticket.start_time >= startTime && ticket.start_time <= endTime);
        }

        // 3. Fetch seat details for all filtered buses in parallel
        console.log(`Fetching seat details for ${allBuses.length} buses...`);
        const ticketDetailPromises = allBuses.map(async ticket => {
            const availableBeautifulSeats = await getAvailableBeautifulSeats(ticket, date, fromProvinceId, toProvinceId);
            if (availableBeautifulSeats.length > 0) {
                return { ...ticket, available_beautiful_seats: availableBeautifulSeats };
            }
            return null;
        });

        const ticketsWithBeautifulSeats = (await Promise.all(ticketDetailPromises)).filter(Boolean);

        // 4. Format the final result
        const finalTickets = ticketsWithBeautifulSeats.map(ticket => {
            const { start_time, id, bus_hop_id, bus_stage_id, ...rest } = ticket;
            return rest;
        });

        res.json({ tickets: finalTickets });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Usage: http://localhost:${port}/tickets?date=YYYYMMDD&from=2&to=1&startTime=HH:mm&endTime=HH:mm`);
});
