# tab26

Tablero local para ver las peticiones de [DevOps](https://redmine.produccion.gob.ar/projects/devops2026/issues) y cambiarles la prioridad (Baja, Normal, Alta) sin recorrer Redmine de a una.

La clave de la API queda en `.env` en esta máquina. El servidor solo escucha en `127.0.0.1` y no la manda al navegador.

## Cómo levantarlo

```bash
npm start
```

Abrí http://127.0.0.1:3780

Si clonás el repo en otra máquina, copiá `.env.example` a `.env` y completá `REDMINE_API_KEY`. Hace falta red o VPN hasta `redmine.produccion.gob.ar`.

Arrastrá una petición a otra columna, o usá “Subir a …” / “Bajar a …”. Redmine guarda la prioridad y puede notificar a quienes siguen la petición. El orden dentro de la columna no se guarda: se muestra por última actualización.
